-- ============================================================
--  FIX: RLS faltando em comissoes/comissao_regras/comissao_movimentos/campanhas
--  As tabelas foram criadas com RLS ligado mas sem policies, o que
--  bloqueia todas as operações. Aqui criamos policies coerentes
--  com o resto do sistema:
--    - LEITURA: admin, comercial, financeiro
--    - ESCRITA: admin, comercial
--  Idempotente (drop + create).
-- ============================================================

-- Helper inline na query: checagem de role
do $$ begin end $$;

-- ── COMISSÕES (registros de comissão por venda) ──────────────
drop policy if exists "comissoes_read"   on public.comissoes;
drop policy if exists "comissoes_insert" on public.comissoes;
drop policy if exists "comissoes_update" on public.comissoes;
drop policy if exists "comissoes_delete" on public.comissoes;

create policy "comissoes_read" on public.comissoes for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "comissoes_insert" on public.comissoes for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);
create policy "comissoes_update" on public.comissoes for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "comissoes_delete" on public.comissoes for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);


-- ── REGRAS DE COMISSÃO (curso × beneficiário × papel × %) ────
drop policy if exists "comissao_regras_read"   on public.comissao_regras;
drop policy if exists "comissao_regras_insert" on public.comissao_regras;
drop policy if exists "comissao_regras_update" on public.comissao_regras;
drop policy if exists "comissao_regras_delete" on public.comissao_regras;

create policy "comissao_regras_read" on public.comissao_regras for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "comissao_regras_insert" on public.comissao_regras for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);
create policy "comissao_regras_update" on public.comissao_regras for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);
create policy "comissao_regras_delete" on public.comissao_regras for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);


-- ── MOVIMENTOS (lançamentos de débito/crédito por comissão) ──
drop policy if exists "comissao_movimentos_read"   on public.comissao_movimentos;
drop policy if exists "comissao_movimentos_insert" on public.comissao_movimentos;
drop policy if exists "comissao_movimentos_update" on public.comissao_movimentos;
drop policy if exists "comissao_movimentos_delete" on public.comissao_movimentos;

create policy "comissao_movimentos_read" on public.comissao_movimentos for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "comissao_movimentos_insert" on public.comissao_movimentos for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "comissao_movimentos_update" on public.comissao_movimentos for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);
create policy "comissao_movimentos_delete" on public.comissao_movimentos for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);


-- ── CAMPANHAS DE COMISSÃO (campanhas de bônus, períodos, etc) ──
drop policy if exists "campanhas_read"   on public.campanhas;
drop policy if exists "campanhas_insert" on public.campanhas;
drop policy if exists "campanhas_update" on public.campanhas;
drop policy if exists "campanhas_delete" on public.campanhas;

create policy "campanhas_read" on public.campanhas for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "campanhas_insert" on public.campanhas for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);
create policy "campanhas_update" on public.campanhas for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);
create policy "campanhas_delete" on public.campanhas for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);


-- ── VERIFICAÇÃO ──────────────────────────────────────────────
-- select tablename, count(*) as policies from pg_policies
-- where schemaname='public' and tablename in ('comissoes','comissao_regras','comissao_movimentos','campanhas')
-- group by tablename;
