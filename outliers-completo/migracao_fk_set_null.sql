-- ============================================================
--  Ajusta FKs que apontam pra profiles/auth.users pra ON DELETE SET NULL
--  Permite excluir usuários sem perder dados históricos.
-- ============================================================

-- Helper: muda uma FK existente pra SET NULL
create or replace function pg_temp.repointFK(p_table text, p_column text, p_ref_table text)
returns void language plpgsql as $$
declare
  v_constraint text;
begin
  -- Acha nome da constraint atual
  select tc.constraint_name into v_constraint
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
  where tc.table_schema = 'public' and tc.table_name = p_table
    and kcu.column_name = p_column
    and tc.constraint_type = 'FOREIGN KEY'
  limit 1;

  if v_constraint is null then return; end if;

  execute format('alter table public.%I drop constraint %I', p_table, v_constraint);
  execute format('alter table public.%I add constraint %I foreign key (%I) references %s(id) on delete set null',
    p_table, v_constraint, p_column, p_ref_table);
end;
$$;

select pg_temp.repointFK('comissao_movimentos', 'criado_por', 'auth.users');
select pg_temp.repointFK('comissoes', 'beneficiario_id', 'public.profiles');
select pg_temp.repointFK('envios_qr', 'enviado_por', 'auth.users');
select pg_temp.repointFK('eventos', 'criado_por', 'auth.users');
select pg_temp.repointFK('historico', 'criado_por', 'auth.users');
select pg_temp.repointFK('lead_stage_history', 'movido_por', 'auth.users');
select pg_temp.repointFK('matriculas', 'criado_por', 'auth.users');
select pg_temp.repointFK('participantes', 'qr_aprovado_por', 'auth.users');
select pg_temp.repointFK('participantes', 'checkin_por', 'auth.users');
select pg_temp.repointFK('storydoing_locacoes', 'responsavel_id', 'public.profiles');
select pg_temp.repointFK('vendas', 'criado_por', 'auth.users');
select pg_temp.repointFK('clientes', 'criado_por', 'auth.users');
select pg_temp.repointFK('clientes', 'responsavel_id', 'public.profiles');
select pg_temp.repointFK('participantes', 'criado_por', 'auth.users');
select pg_temp.repointFK('financeiro', 'criado_por', 'auth.users');
select pg_temp.repointFK('parcelas', 'criado_por', 'auth.users');
select pg_temp.repointFK('contas_pagar', 'criado_por', 'auth.users');
select pg_temp.repointFK('storydoing_locacoes', 'criado_por', 'auth.users');
select pg_temp.repointFK('solicitacoes', 'criado_por', 'auth.users');
