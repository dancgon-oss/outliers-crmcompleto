-- ============================================================
--  STORYDOING: comissão dividida POR parcela
--  Cada parcela da locação gera uma conta_pagar separada com:
--   - valor = parcela.valor × comissao_percentual / 100
--   - vencimento = data do pago_em (se parcela paga) ou vencimento parcela
--   - status = Pendente até admin pagar (mesmo se cliente já pagou)
-- ============================================================

-- 1) Coluna parcela_id em contas_pagar pra rastreio
alter table public.contas_pagar
  add column if not exists parcela_storydoing_id uuid
  references public.storydoing_parcelas(id) on delete cascade;

create unique index if not exists contas_pagar_parc_sd_unique
  on public.contas_pagar (parcela_storydoing_id)
  where parcela_storydoing_id is not null;

-- 2) Remove contas únicas existentes vinculadas a locacao_id
--    (vamos recriar como contas por parcela)
delete from public.contas_pagar
 where locacao_id is not null and parcela_storydoing_id is null;

-- 3) Drop triggers antigos
drop trigger if exists tg_sd_loc_to_conta_trg on public.storydoing_locacoes;
drop function if exists public.tg_storydoing_loc_to_conta() cascade;

-- 4) Função: regenera contas a pagar de UMA locação (1 por parcela)
create or replace function public.regenerar_contas_locacao(p_loc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc record;
  v_resp_nome text;
  v_descricao_base text;
  v_pct numeric;
  rec record;
  v_valor_comissao numeric;
  v_venc date;
  v_status text;
  v_pago_em date;
  v_existing_id uuid;
begin
  select * into v_loc from public.storydoing_locacoes where id = p_loc_id;
  if not found then return; end if;

  -- Sem responsável ou comissão -> apaga todas as contas vinculadas
  if v_loc.responsavel_id is null or coalesce(v_loc.comissao_percentual, 0) <= 0 then
    delete from public.contas_pagar
      where parcela_storydoing_id in (
        select id from public.storydoing_parcelas where locacao_id = p_loc_id
      ) or locacao_id = p_loc_id;
    return;
  end if;

  v_resp_nome := coalesce(v_loc.responsavel_nome,
    (select nome from public.profiles where id = v_loc.responsavel_id),
    'Responsável');
  v_descricao_base := 'Comissão Storydoing — ' || v_resp_nome
    || ' · Sala ' || upper(coalesce(v_loc.sala, ''))
    || ' · ' || coalesce(v_loc.locador_nome, '');
  v_pct := coalesce(v_loc.comissao_percentual, 0);

  -- Pra cada parcela da locação cria/atualiza uma conta
  for rec in select * from public.storydoing_parcelas where locacao_id = p_loc_id order by numero
  loop
    v_valor_comissao := round((coalesce(rec.valor, 0) * v_pct / 100)::numeric, 2);
    if v_valor_comissao <= 0 then continue; end if;

    -- Vencimento: se parcela ja paga, usa a data de pagamento; senao usa vencimento
    if rec.status = 'Pago' and rec.pago_em is not null then
      v_venc := rec.pago_em;
    else
      v_venc := coalesce(rec.vencimento, v_loc.data_locacao, current_date);
    end if;

    -- Status da conta: Pendente até admin pagar manualmente
    v_status := 'Pendente';
    v_pago_em := null;

    -- Se já existe conta dessa parcela, mantém o status (admin pode ter pago)
    select id, status, pago_em into v_existing_id, v_status, v_pago_em
      from public.contas_pagar where parcela_storydoing_id = rec.id;

    if v_existing_id is not null then
      update public.contas_pagar set
        descricao = v_descricao_base || ' · Parcela ' || rec.numero || '/'
                   || (select count(*) from public.storydoing_parcelas where locacao_id = p_loc_id),
        fornecedor = v_resp_nome,
        categoria = 'Comissões',
        valor = v_valor_comissao,
        vencimento = v_venc,
        forma_pagamento = coalesce(forma_pagamento, 'PIX'),
        observacoes = 'Conta gerada automaticamente — parcela ' || rec.numero
                     || ' da locação Storydoing'
                     || case when rec.status = 'Pago' then ' (cliente já pagou)' else ' (aguardando cliente)' end,
        origem = 'Storydoing',
        locacao_id = p_loc_id,
        parcela_storydoing_id = rec.id,
        updated_at = now()
      where id = v_existing_id;
    else
      insert into public.contas_pagar (
        descricao, fornecedor, categoria, valor, vencimento,
        forma_pagamento, observacoes, status, pago_em,
        locacao_id, parcela_storydoing_id, origem, criado_por
      ) values (
        v_descricao_base || ' · Parcela ' || rec.numero || '/'
          || (select count(*) from public.storydoing_parcelas where locacao_id = p_loc_id),
        v_resp_nome, 'Comissões', v_valor_comissao, v_venc,
        'PIX',
        'Conta gerada automaticamente — parcela ' || rec.numero
          || ' da locação Storydoing'
          || case when rec.status = 'Pago' then ' (cliente já pagou)' else ' (aguardando cliente)' end,
        'Pendente', null,
        p_loc_id, rec.id, 'Storydoing', v_loc.criado_por
      );
    end if;
  end loop;

  -- Apaga contas órfãs (de parcelas que foram removidas)
  delete from public.contas_pagar
    where locacao_id = p_loc_id
      and parcela_storydoing_id is not null
      and parcela_storydoing_id not in (
        select id from public.storydoing_parcelas where locacao_id = p_loc_id
      );
end;
$$;

grant execute on function public.regenerar_contas_locacao(uuid) to authenticated, service_role;

-- 5) Triggers que chamam a regeneração
create or replace function public.tg_sd_loc_regen_contas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.regenerar_contas_locacao(NEW.id);
  return NEW;
end;
$$;

create or replace function public.tg_sd_parc_regen_contas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_loc_id uuid;
begin
  v_loc_id := coalesce(NEW.locacao_id, OLD.locacao_id);
  if v_loc_id is null then return coalesce(NEW, OLD); end if;
  perform public.regenerar_contas_locacao(v_loc_id);
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists tg_sd_loc_regen_trg on public.storydoing_locacoes;
create trigger tg_sd_loc_regen_trg
  after insert or update on public.storydoing_locacoes
  for each row execute function public.tg_sd_loc_regen_contas();

drop trigger if exists tg_sd_parc_regen_trg on public.storydoing_parcelas;
create trigger tg_sd_parc_regen_trg
  after insert or update or delete on public.storydoing_parcelas
  for each row execute function public.tg_sd_parc_regen_contas();

-- 6) Trigger reverso atualizado: marcar conta como Pago atualiza
--    locacao.comissao_paga só quando TODAS as contas-parcela estão pagas
create or replace function public.tg_contas_to_storydoing_loc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc_id uuid;
  v_total int;
  v_pagas int;
begin
  v_loc_id := NEW.locacao_id;
  if v_loc_id is null then return NEW; end if;

  -- Conta total de contas-comissão dessa locação e quantas estão pagas
  select count(*), count(*) filter (where status = 'Pago')
    into v_total, v_pagas
    from public.contas_pagar
   where locacao_id = v_loc_id and parcela_storydoing_id is not null;

  -- Se todas pagas → marca locação como comissão paga total
  if v_total > 0 and v_pagas = v_total then
    update public.storydoing_locacoes
       set comissao_paga = true,
           comissao_paga_em = coalesce(NEW.pago_em, current_date)
     where id = v_loc_id and coalesce(comissao_paga, false) = false;
  -- Se alguma desmarcou → volta locação pra não paga
  elsif v_pagas < v_total then
    update public.storydoing_locacoes
       set comissao_paga = false,
           comissao_paga_em = null
     where id = v_loc_id and comissao_paga = true;
  end if;
  return NEW;
end;
$$;

-- 7) Migração: regenera contas pra todas as locações existentes
do $$
declare rec record;
begin
  for rec in select id from public.storydoing_locacoes loop
    perform public.regenerar_contas_locacao(rec.id);
  end loop;
end $$;
