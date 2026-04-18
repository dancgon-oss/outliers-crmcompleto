-- ============================================================
--  MIGRAÇÃO v5 — Novos Perfis de Acesso
--  Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Atualizar o check de role para incluir os novos perfis
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'comercial', 'financeiro', 'operacional'));

-- 2. Atualizar a função de criação automática de perfil
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nome, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'operacional')
  ) on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- 3. Atualizar políticas de segurança para os novos perfis

-- Clientes: operacional pode inserir mas não deletar/alterar status
drop policy if exists "clientes_delete" on public.clientes;
create policy "clientes_delete" on public.clientes for delete using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role in ('admin', 'comercial', 'financeiro')
  )
);

-- Financeiro: apenas admin, comercial e financeiro podem ver
drop policy if exists "fin_read" on public.financeiro;
create policy "fin_read" on public.financeiro for select using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role in ('admin', 'comercial', 'financeiro')
  )
);

-- Parcelas: apenas admin, comercial e financeiro podem ver
drop policy if exists "parc_read" on public.parcelas;
create policy "parc_read" on public.parcelas for select using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role in ('admin', 'comercial', 'financeiro')
  )
);

drop policy if exists "parc_update" on public.parcelas;
create policy "parc_update" on public.parcelas for update using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role in ('admin', 'comercial', 'financeiro')
  )
);

-- Contratos: todos autenticados podem inserir (para check-in), mas só admin/comercial/financeiro leem
drop policy if exists "cont_read" on public.contratos;
create policy "cont_read" on public.contratos for select using (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role in ('admin', 'comercial', 'financeiro')
  )
);

-- ============================================================
-- VERIFICAÇÃO: rode esta query para confirmar
-- SELECT role, count(*) FROM public.profiles GROUP BY role;
-- ============================================================
