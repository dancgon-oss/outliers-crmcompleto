-- ============================================================
--  STORYDOING: comissão da locação vira automaticamente uma
--  conta a pagar (origem='Storydoing', categoria='Comissões')
--  Sincronização bidirecional:
--   - Salva locação → cria/atualiza conta_pagar correspondente
--   - Marca conta como Pago → atualiza locação.comissao_paga
--   - Apaga locação → apaga conta correspondente (cascade)
-- ============================================================

-- 1) Adiciona coluna locacao_id em contas_pagar pra rastreio
alter table public.contas_pagar
  add column if not exists locacao_id uuid references public.storydoing_locacoes(id) on delete cascade;

create unique index if not exists contas_pagar_locacao_unique
  on public.contas_pagar (locacao_id)
  where locacao_id is not null;

-- 2) Trigger: ao salvar locação, cria/atualiza conta
create or replace function public.tg_storydoing_loc_to_conta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_descricao text;
  v_existing_id uuid;
  v_responsavel_nome text;
begin
  -- Só processa se houver comissão e responsável
  if NEW.responsavel_id is null or coalesce(NEW.comissao_valor, 0) <= 0 then
    -- Se a locação não tem mais responsável/comissão, apaga conta existente (se houver)
    delete from public.contas_pagar where locacao_id = NEW.id;
    return NEW;
  end if;

  -- Busca nome do responsável (atual ou snapshot)
  v_responsavel_nome := coalesce(NEW.responsavel_nome,
    (select nome from public.profiles where id = NEW.responsavel_id),
    'Responsável');

  v_descricao := 'Comissão Storydoing — ' || v_responsavel_nome
    || ' · Sala ' || upper(coalesce(NEW.sala, ''))
    || ' · ' || coalesce(NEW.locador_nome, '');

  -- Verifica se já existe conta vinculada a esta locação
  select id into v_existing_id from public.contas_pagar where locacao_id = NEW.id;

  if v_existing_id is not null then
    -- Atualiza conta existente
    update public.contas_pagar set
      descricao = v_descricao,
      fornecedor = v_responsavel_nome,
      categoria = 'Comissões',
      valor = NEW.comissao_valor,
      vencimento = coalesce(NEW.data_locacao, current_date),
      forma_pagamento = 'PIX',
      observacoes = 'Conta gerada automaticamente pela locação Storydoing #' || NEW.id::text,
      status = case when NEW.comissao_paga then 'Pago' else 'Pendente' end,
      pago_em = case when NEW.comissao_paga then coalesce(NEW.comissao_paga_em, current_date) else null end,
      updated_at = now()
    where id = v_existing_id;
  else
    -- Cria nova conta
    insert into public.contas_pagar (
      descricao, fornecedor, categoria, valor, vencimento,
      forma_pagamento, observacoes, status, pago_em,
      locacao_id, origem, criado_por
    ) values (
      v_descricao, v_responsavel_nome, 'Comissões', NEW.comissao_valor,
      coalesce(NEW.data_locacao, current_date),
      'PIX',
      'Conta gerada automaticamente pela locação Storydoing #' || NEW.id::text,
      case when NEW.comissao_paga then 'Pago' else 'Pendente' end,
      case when NEW.comissao_paga then coalesce(NEW.comissao_paga_em, current_date) else null end,
      NEW.id, 'Storydoing', NEW.criado_por
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_sd_loc_to_conta_trg on public.storydoing_locacoes;
create trigger tg_sd_loc_to_conta_trg
  after insert or update on public.storydoing_locacoes
  for each row execute function public.tg_storydoing_loc_to_conta();

-- 3) Trigger reverso: quando marca conta_pagar de Storydoing como Pago,
--    atualiza locacao.comissao_paga
create or replace function public.tg_contas_to_storydoing_loc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.locacao_id is null then return NEW; end if;

  if NEW.status = 'Pago' and (OLD.status is distinct from 'Pago') then
    update public.storydoing_locacoes
       set comissao_paga = true,
           comissao_paga_em = coalesce(NEW.pago_em, current_date)
     where id = NEW.locacao_id and coalesce(comissao_paga, false) = false;
  elsif NEW.status <> 'Pago' and OLD.status = 'Pago' then
    update public.storydoing_locacoes
       set comissao_paga = false,
           comissao_paga_em = null
     where id = NEW.locacao_id and comissao_paga = true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_contas_to_sd_loc_trg on public.contas_pagar;
create trigger tg_contas_to_sd_loc_trg
  after update of status on public.contas_pagar
  for each row execute function public.tg_contas_to_storydoing_loc();

-- 4) Migração retroativa: cria contas pra locações existentes com comissão
do $$
declare
  rec record;
begin
  for rec in
    select * from public.storydoing_locacoes
    where responsavel_id is not null and coalesce(comissao_valor, 0) > 0
  loop
    -- só cria se ainda não existe
    if not exists (select 1 from public.contas_pagar where locacao_id = rec.id) then
      insert into public.contas_pagar (
        descricao, fornecedor, categoria, valor, vencimento,
        forma_pagamento, observacoes, status, pago_em,
        locacao_id, origem, criado_por
      ) values (
        'Comissão Storydoing — ' || coalesce(rec.responsavel_nome, 'Responsável')
          || ' · Sala ' || upper(coalesce(rec.sala, ''))
          || ' · ' || coalesce(rec.locador_nome, ''),
        coalesce(rec.responsavel_nome, 'Responsável'),
        'Comissões', rec.comissao_valor,
        coalesce(rec.data_locacao, current_date),
        'PIX',
        'Conta gerada automaticamente pela locação Storydoing #' || rec.id::text,
        case when rec.comissao_paga then 'Pago' else 'Pendente' end,
        case when rec.comissao_paga then coalesce(rec.comissao_paga_em, current_date) else null end,
        rec.id, 'Storydoing', rec.criado_por
      );
    end if;
  end loop;
end $$;
