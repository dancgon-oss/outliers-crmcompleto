-- ============================================================
--  AJUSTE: tabela `comissoes` tem coluna `venda_id` com FK para
--  uma tabela `vendas` que nao usamos (a venda real fica em
--  `financeiro`). Este SQL:
--    1) remove a FK quebrada
--    2) torna venda_id opcional
--    3) torna valor_base opcional (mantemos preenchido pelo app)
--
--  Idempotente: pode rodar varias vezes.
-- ============================================================

-- 1) Remove FK quebrada
alter table public.comissoes
  drop constraint if exists comissoes_venda_id_fkey;

-- 2) Torna venda_id opcional
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comissoes' and column_name = 'venda_id'
      and is_nullable = 'NO'
  ) then
    alter table public.comissoes alter column venda_id drop not null;
  end if;
end $$;

-- 3) Torna valor_base opcional
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comissoes' and column_name = 'valor_base'
      and is_nullable = 'NO'
  ) then
    alter table public.comissoes alter column valor_base drop not null;
  end if;
end $$;

-- VERIFICACAO:
-- select column_name, is_nullable from information_schema.columns
-- where table_schema='public' and table_name='comissoes'
-- order by ordinal_position;
