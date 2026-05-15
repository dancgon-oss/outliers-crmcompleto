-- ============================================================
--  MIGRACAO: Fluxo de Comissoes + Notificacoes
--
--  O que faz:
--   1) Cria tabela `notificacoes` (sininho do admin no CRM)
--   2) Cria funcao que LIBERA comissoes proporcionalmente quando
--      uma parcela do cliente e paga (movimento tipo 'liberacao')
--   3) Cria trigger AFTER UPDATE em `parcelas` que dispara a liberacao
--      e cria notificacao quando status muda para 'Pago'
--   4) Cria view `vw_comissoes_parcelas` com fluxo detalhado
--      por parcela (uma linha por parcela do cliente × beneficiario)
--   5) RLS coerente
--
--  Idempotente: pode rodar varias vezes sem erro.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1) TABELA: notificacoes
-- ──────────────────────────────────────────────────────────────
create table if not exists public.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,                 -- 'pagamento_recebido' | 'comissao_liberada' | etc.
  titulo      text not null,
  mensagem    text,
  link        text,                          -- rota interna no app, opcional
  para_role   text default 'admin',          -- quem ve: admin (todos os admins veem)
  parcela_id  uuid references public.parcelas(id) on delete set null,
  cliente_id  uuid references public.clientes(id) on delete set null,
  lida        boolean not null default false,
  lida_em     timestamptz,
  lida_por    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists notificacoes_role_lida_idx on public.notificacoes (para_role, lida, created_at desc);
create index if not exists notificacoes_created_idx on public.notificacoes (created_at desc);

alter table public.notificacoes enable row level security;

drop policy if exists "notif_read"   on public.notificacoes;
drop policy if exists "notif_insert" on public.notificacoes;
drop policy if exists "notif_update" on public.notificacoes;
drop policy if exists "notif_delete" on public.notificacoes;

-- Leitura: admin sempre; outros so se a notificacao for direcionada ao seu role
create policy "notif_read" on public.notificacoes for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or p.role = para_role)
  )
);
-- Insert: qualquer usuario autenticado (o webhook usa service_role e bypassa)
create policy "notif_insert" on public.notificacoes for insert with check (
  auth.uid() is not null
);
-- Update: admin (marca como lida)
create policy "notif_update" on public.notificacoes for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "notif_delete" on public.notificacoes for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- ──────────────────────────────────────────────────────────────
-- 2) FUNCAO: liberar comissoes proporcional ao valor da parcela paga
-- ──────────────────────────────────────────────────────────────
create or replace function public.liberar_comissoes_de_parcela(p_parcela_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_financeiro_id uuid;
  v_valor_pago    numeric;
  v_total_venda   numeric;
  v_fracao        numeric;
  c               record;
  v_liberar       numeric;
begin
  -- Busca dados da parcela e total da venda
  select pa.financeiro_id, pa.valor, fi.valor_total
    into v_financeiro_id, v_valor_pago, v_total_venda
  from public.parcelas pa
  join public.financeiro fi on fi.id = pa.financeiro_id
  where pa.id = p_parcela_id;

  if v_financeiro_id is null or v_total_venda is null or v_total_venda <= 0 then
    return;
  end if;

  v_fracao := v_valor_pago / v_total_venda;

  -- Para cada comissao desta venda (financeiro), cria movimento de liberacao proporcional
  for c in
    select id, valor_total, valor_liberado
    from public.comissoes
    where financeiro_id = v_financeiro_id
      and (status is null or status not in ('Cancelada'))
  loop
    v_liberar := round( (c.valor_total * v_fracao)::numeric , 2 );
    -- nao libera mais do que o total
    if (coalesce(c.valor_liberado,0) + v_liberar) > c.valor_total then
      v_liberar := c.valor_total - coalesce(c.valor_liberado,0);
    end if;

    if v_liberar > 0 then
      insert into public.comissao_movimentos (comissao_id, tipo, valor, descricao)
      values (c.id, 'liberacao', v_liberar,
              'Auto: parcela ' || p_parcela_id::text || ' do cliente paga');

      update public.comissoes
         set valor_liberado = coalesce(valor_liberado,0) + v_liberar,
             updated_at = now()
       where id = c.id;
    end if;
  end loop;
end;
$$;

grant execute on function public.liberar_comissoes_de_parcela(uuid) to authenticated, service_role;

-- ──────────────────────────────────────────────────────────────
-- 3) TRIGGER: ao marcar parcela como Pago, libera comissoes + notifica
-- ──────────────────────────────────────────────────────────────
create or replace function public.tg_parcela_paga()
returns trigger
language plpgsql
security definer
as $$
declare
  v_cliente_id   uuid;
  v_cliente_nome text;
  v_titulo       text;
  v_msg          text;
begin
  -- Dispara apenas quando status mudou para 'Pago' (vindo de qualquer outro)
  if NEW.status = 'Pago' and (OLD.status is distinct from 'Pago') then
    -- 1) Libera comissoes proporcionais
    perform public.liberar_comissoes_de_parcela(NEW.id);

    -- 2) Cria notificacao para o admin
    select fi.cliente_id into v_cliente_id
      from public.financeiro fi where fi.id = NEW.financeiro_id;
    select nome into v_cliente_nome
      from public.clientes where id = v_cliente_id;

    v_titulo := 'Pagamento recebido';
    v_msg := coalesce(v_cliente_nome,'Cliente') || ' pagou a parcela ' || coalesce(NEW.numero::text,'?')
             || ' (' || to_char(NEW.valor, 'FM999G999G990D00') || ').';

    insert into public.notificacoes (tipo, titulo, mensagem, parcela_id, cliente_id, para_role)
    values ('pagamento_recebido', v_titulo, v_msg, NEW.id, v_cliente_id, 'admin');
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_parcela_paga_trg on public.parcelas;
create trigger tg_parcela_paga_trg
  after update of status on public.parcelas
  for each row execute function public.tg_parcela_paga();

-- ──────────────────────────────────────────────────────────────
-- 4) VIEW: fluxo detalhado por parcela × beneficiario
--    Cada linha = 1 parcela do cliente × 1 beneficiario que recebe comissao.
-- ──────────────────────────────────────────────────────────────
create or replace view public.vw_comissoes_parcelas as
select
  c.id                              as comissao_id,
  c.beneficiario_id,
  pr.nome                           as beneficiario_nome,
  c.papel,
  c.percentual,
  c.cliente_id,
  cli.nome                          as cliente_nome,
  c.curso_id,
  cur.nome                          as curso_nome,
  c.valor_total                     as comissao_total,
  c.financeiro_id,
  pa.id                             as parcela_id,
  pa.numero                         as parcela_numero,
  pa.valor                          as parcela_valor_cliente,
  pa.vencimento                     as parcela_vencimento,
  pa.status                         as parcela_status,
  pa.pago_em                        as parcela_pago_em,
  -- Valor da comissao desta parcela = comissao_total * (parcela.valor / financeiro.valor_total)
  round( (c.valor_total * pa.valor / nullif(fi.valor_total,0))::numeric , 2 )
                                    as comissao_parcela_valor,
  case
    when pa.status = 'Pago' then 'Liberada'
    when pa.status = 'Atrasado' then 'Atrasada'
    else 'Prevista'
  end                               as comissao_parcela_status
from public.comissoes c
join public.financeiro  fi on fi.id = c.financeiro_id
join public.parcelas    pa on pa.financeiro_id = fi.id
left join public.profiles pr on pr.id = c.beneficiario_id
left join public.clientes cli on cli.id = c.cliente_id
left join public.cursos   cur on cur.id = c.curso_id
where c.status is null or c.status <> 'Cancelada';

-- A view herda RLS das tabelas base (comissoes ja tem policies)

-- ──────────────────────────────────────────────────────────────
-- 5) VERIFICACAO
-- ──────────────────────────────────────────────────────────────
-- select count(*) from public.notificacoes;
-- select * from public.vw_comissoes_parcelas limit 5;
-- update public.parcelas set status='Pago' where id='<algum-id>';  -- testa o trigger
