-- ============================================================
--  CONTAS A PAGAR + suporte para DRE
--  Idempotente.
-- ============================================================

create table if not exists public.contas_pagar (
  id           uuid primary key default gen_random_uuid(),
  descricao    text not null,
  fornecedor   text,
  categoria    text,
  valor        numeric not null,
  vencimento   date not null,
  pago_em      date,
  status       text not null default 'Pendente'
                check (status in ('Pendente','Pago','Atrasado','Cancelado')),
  forma_pagamento text,
  observacoes  text,
  recorrente   boolean not null default false,
  criado_por   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists contas_pagar_status_venc_idx on public.contas_pagar (status, vencimento);
create index if not exists contas_pagar_pago_em_idx     on public.contas_pagar (pago_em);
create index if not exists contas_pagar_categoria_idx   on public.contas_pagar (categoria);

alter table public.contas_pagar enable row level security;

drop policy if exists "cp_read"   on public.contas_pagar;
drop policy if exists "cp_insert" on public.contas_pagar;
drop policy if exists "cp_update" on public.contas_pagar;
drop policy if exists "cp_delete" on public.contas_pagar;

-- Leitura: admin/financeiro/comercial
create policy "cp_read" on public.contas_pagar for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
-- Insert/Update: admin/financeiro
create policy "cp_insert" on public.contas_pagar for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);
create policy "cp_update" on public.contas_pagar for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);
-- Delete: admin
create policy "cp_delete" on public.contas_pagar for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- ──────────────────────────────────────────────────────────────
--  VIEWS para DRE
-- ──────────────────────────────────────────────────────────────

-- Receita realizada por mes (regime caixa: parcela paga)
create or replace view public.vw_dre_receita_mensal as
select
  to_char(date_trunc('month', pa.pago_em::date), 'YYYY-MM')  as mes,
  date_trunc('month', pa.pago_em::date)::date               as mes_inicio,
  count(*)                                                   as qtd_parcelas,
  sum(pa.valor)                                              as receita
from public.parcelas pa
where pa.status = 'Pago' and pa.pago_em is not null
group by 1, 2
order by 2 desc;

-- Despesas: comissoes pagas + contas a pagar pagas, por mes
create or replace view public.vw_dre_despesas_mensal as
select
  to_char(date_trunc('month', cm.created_at::date), 'YYYY-MM') as mes,
  date_trunc('month', cm.created_at::date)::date              as mes_inicio,
  'Comissões' as categoria,
  sum(cm.valor) as valor
from public.comissao_movimentos cm
where cm.tipo = 'pagamento'
group by 1,2
union all
select
  to_char(date_trunc('month', cp.pago_em::date), 'YYYY-MM') as mes,
  date_trunc('month', cp.pago_em::date)::date              as mes_inicio,
  coalesce(cp.categoria, 'Outras') as categoria,
  sum(cp.valor) as valor
from public.contas_pagar cp
where cp.status = 'Pago' and cp.pago_em is not null
group by 1,2,3
order by 2 desc, 3;

-- Resumo: receita - despesas por mes
create or replace view public.vw_dre_resumo_mensal as
with rec as (
  select mes, mes_inicio, sum(receita) as receita
    from public.vw_dre_receita_mensal group by mes, mes_inicio
), des as (
  select mes, mes_inicio, sum(valor) as despesas
    from public.vw_dre_despesas_mensal group by mes, mes_inicio
)
select
  coalesce(r.mes, d.mes)               as mes,
  coalesce(r.mes_inicio, d.mes_inicio) as mes_inicio,
  coalesce(r.receita, 0)               as receita,
  coalesce(d.despesas, 0)              as despesas,
  coalesce(r.receita,0) - coalesce(d.despesas,0) as resultado
from rec r
full outer join des d on d.mes = r.mes
order by 2 desc;

-- ──────────────────────────────────────────────────────────────
-- Marca contas como Atrasado quando vencimento passou e nao pagou
-- (rode periodicamente OU chame de uma function/cron)
-- ──────────────────────────────────────────────────────────────
create or replace function public.atualizar_contas_atrasadas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  update public.contas_pagar
     set status = 'Atrasado', updated_at = now()
   where status = 'Pendente' and vencimento < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.atualizar_contas_atrasadas() to authenticated, service_role;
