-- ============================================================
--  MNI — Método Neuro Impacto
--  Cria estrutura mínima pra gerir o financeiro do evento:
--    • clientes com programa='MNI' + campo hunter (vendedor)
--    • config de split de lucro entre sócios (Lucas/Aldo etc)
--    • permite contas_pagar.origem = 'MNI'
--
--  Idempotente. Pode rodar várias vezes.
-- ============================================================

-- 1) Adiciona campo HUNTER (vendedor que captou) na tabela clientes
alter table public.clientes
  add column if not exists hunter text;

create index if not exists clientes_hunter_idx on public.clientes (hunter);

-- 2) Tabela de sócios e % de split do MNI
--    Permite cadastrar quantos sócios quiser. A soma deveria ser 100, mas
--    o sistema não força — quem mantém é o admin.
create table if not exists public.mni_socios (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  percentual  numeric(5,2) not null default 50.00 check (percentual >= 0 and percentual <= 100),
  ativo       boolean not null default true,
  ordem       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seed inicial (idempotente): Lucas e Aldo 50/50
insert into public.mni_socios (nome, percentual, ativo, ordem)
select 'Lucas Labastie', 50.00, true, 0
where not exists (select 1 from public.mni_socios where nome = 'Lucas Labastie');

insert into public.mni_socios (nome, percentual, ativo, ordem)
select 'Aldo', 50.00, true, 1
where not exists (select 1 from public.mni_socios where nome = 'Aldo');

-- 3) RLS na tabela de sócios
alter table public.mni_socios enable row level security;

drop policy if exists "mni_socios_read"   on public.mni_socios;
drop policy if exists "mni_socios_write"  on public.mni_socios;

create policy "mni_socios_read" on public.mni_socios for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "mni_socios_write" on public.mni_socios for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
) with check (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 4) Garante que 'MNI' é aceito como origem em clientes (check já foi removido em
--    migrações anteriores; aqui fazemos a remoção defensiva caso esteja recriado)
do $$
begin
  if exists (
    select 1 from information_schema.check_constraints
    where constraint_schema='public' and constraint_name='clientes_origem_check'
  ) then
    alter table public.clientes drop constraint clientes_origem_check;
  end if;
end$$;

-- 5) View consolidada do DRE MNI por mês
--    Receita = parcelas de clientes programa='MNI' pagas no mês
--    Custos = contas_pagar origem='MNI' pagas no mês
create or replace view public.v_mni_dre_mensal as
with rec as (
  select
    date_trunc('month', p.pago_em)::date as mes,
    sum(p.valor) as receita
  from public.parcelas p
  join public.financeiro f on f.id = p.financeiro_id
  join public.clientes c on c.id = f.cliente_id
  where p.status = 'Pago'
    and p.pago_em is not null
    and c.programa = 'MNI'
  group by 1
),
cst as (
  select
    date_trunc('month', cp.pago_em)::date as mes,
    sum(cp.valor) as custos,
    jsonb_object_agg(coalesce(cp.categoria, 'Outros'), sum(cp.valor)) as por_categoria
  from public.contas_pagar cp
  where cp.status = 'Pago'
    and cp.pago_em is not null
    and cp.origem = 'MNI'
  group by 1
)
select
  coalesce(rec.mes, cst.mes) as mes,
  coalesce(rec.receita, 0)   as receita,
  coalesce(cst.custos, 0)    as custos,
  coalesce(rec.receita, 0) - coalesce(cst.custos, 0) as lucro,
  cst.por_categoria
from rec full outer join cst using (mes)
order by mes desc;

grant select on public.v_mni_dre_mensal to authenticated;
