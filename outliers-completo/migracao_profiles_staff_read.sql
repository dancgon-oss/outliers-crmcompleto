-- ============================================================
--  PROFILES: permitir que admin/comercial/financeiro vejam todos
--  os usuarios (necessario para listar beneficiarios de comissoes,
--  vendedores em selects de regras, etc).
--
--  Sem isso, o RLS so permite cada usuario ver o proprio perfil
--  e os selects de beneficiario aparecem vazios.
--
--  Implementacao: usa funcao SECURITY DEFINER para evitar recursao
--  (policy de select em profiles consultando a propria tabela).
--
--  Idempotente.
-- ============================================================

-- Funcao auxiliar: retorna o role do usuario logado (sem RLS)
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

grant execute on function public.current_user_role() to authenticated, service_role;

-- Garante RLS ligado
alter table public.profiles enable row level security;

-- Adiciona policy: staff (admin/comercial/financeiro) le todos os profiles
drop policy if exists "profiles_staff_read_all" on public.profiles;
create policy "profiles_staff_read_all"
on public.profiles
for select
using (
  id = auth.uid()
  or public.current_user_role() in ('admin','comercial','financeiro')
);

-- VERIFICACAO:
-- select tablename, policyname from pg_policies where schemaname='public' and tablename='profiles';
-- select count(*) from public.profiles;
