-- ============================================================
--  MIGRAÇÃO v7 — Cursos online + Portal do aluno
--  Execute no SQL Editor do Supabase
--  Não destrutiva: só adiciona tabelas e amplia constraint de role
-- ============================================================

-- ── 1. Role 'aluno' ──────────────────────────────────────────
-- Alunos autenticados têm acesso limitado: só ao próprio portal,
-- sem visibilidade do CRM/Financeiro/Eventos administrativos.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'comercial', 'financeiro', 'operacional', 'aluno'));


-- ── 2. CURSOS ────────────────────────────────────────────────
create table if not exists public.cursos (
  id             uuid default gen_random_uuid() primary key,
  nome           text not null,
  slug           text unique,                  -- ex: 'metodo-cash', 'pqv'
  descricao      text,
  capa_url       text,                         -- URL de imagem de capa
  duracao_horas  numeric(6,2),
  preco_avulso   numeric(10,2),                -- preço se vendido isolado (opcional)
  ordem          int default 0,                -- ordem de exibição no catálogo
  ativo          boolean default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_cursos_slug on public.cursos(slug);
create index if not exists idx_cursos_ativo on public.cursos(ativo);


-- ── 3. MÓDULOS (aulas dentro do curso) ───────────────────────
create table if not exists public.modulos (
  id           uuid default gen_random_uuid() primary key,
  curso_id     uuid references public.cursos(id) on delete cascade not null,
  nome         text not null,
  descricao    text,
  ordem        int not null default 0,
  video_url    text,                           -- YouTube, Vimeo (embed supported)
  duracao_min  int,                            -- duração em minutos
  material_url text,                           -- link de PDF/material complementar
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_modulos_curso on public.modulos(curso_id, ordem);


-- ── 4. MATRÍCULAS (cliente ↔ curso) ──────────────────────────
create table if not exists public.matriculas (
  id              uuid default gen_random_uuid() primary key,
  cliente_id      uuid references public.clientes(id) on delete cascade not null,
  curso_id        uuid references public.cursos(id) on delete cascade not null,
  tipo            text not null default 'Incluso' check (tipo in ('Incluso','Compra Avulsa','Bônus','Cortesia')),
  status          text not null default 'Ativa' check (status in ('Ativa','Expirada','Cancelada')),
  financeiro_id   uuid references public.financeiro(id),   -- se foi compra avulsa
  matriculado_em  timestamptz default now(),
  expira_em       timestamptz,
  criado_por      uuid references public.profiles(id),
  created_at      timestamptz default now(),
  unique (cliente_id, curso_id)                            -- 1 matrícula por cliente por curso
);

create index if not exists idx_matriculas_cliente on public.matriculas(cliente_id);
create index if not exists idx_matriculas_curso on public.matriculas(curso_id);
create index if not exists idx_matriculas_status on public.matriculas(status);


-- ── 5. PROGRESSO POR MÓDULO ──────────────────────────────────
-- Uma linha por (cliente × módulo assistido).
create table if not exists public.progresso_modulos (
  id                   uuid default gen_random_uuid() primary key,
  cliente_id           uuid references public.clientes(id) on delete cascade not null,
  modulo_id            uuid references public.modulos(id) on delete cascade not null,
  iniciado_em          timestamptz default now(),
  concluido_em         timestamptz,
  tempo_assistido_seg  int default 0,
  updated_at           timestamptz default now(),
  unique (cliente_id, modulo_id)
);

create index if not exists idx_progresso_cliente on public.progresso_modulos(cliente_id);
create index if not exists idx_progresso_modulo  on public.progresso_modulos(modulo_id);


-- ── 6. ROW LEVEL SECURITY ────────────────────────────────────
alter table public.cursos             enable row level security;
alter table public.modulos            enable row level security;
alter table public.matriculas         enable row level security;
alter table public.progresso_modulos  enable row level security;

-- CURSOS: todos autenticados leem (aluno precisa ver catálogo); staff escreve.
drop policy if exists "cursos_read"  on public.cursos;
drop policy if exists "cursos_write" on public.cursos;
create policy "cursos_read"  on public.cursos for select using (auth.role() = 'authenticated');
create policy "cursos_write" on public.cursos for all    using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);

-- MÓDULOS: idem.
drop policy if exists "modulos_read"  on public.modulos;
drop policy if exists "modulos_write" on public.modulos;
create policy "modulos_read"  on public.modulos for select using (auth.role() = 'authenticated');
create policy "modulos_write" on public.modulos for all    using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);

-- MATRÍCULAS: staff vê tudo; aluno só vê as próprias (match por e-mail).
drop policy if exists "matriculas_read"  on public.matriculas;
drop policy if exists "matriculas_write" on public.matriculas;
create policy "matriculas_read" on public.matriculas for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
  or exists (
    select 1 from public.clientes c, public.profiles p
    where c.id = matriculas.cliente_id and p.id = auth.uid() and lower(c.email) = lower(p.email)
  )
);
create policy "matriculas_write" on public.matriculas for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);

-- PROGRESSO: staff vê tudo; aluno vê/edita só o próprio.
drop policy if exists "progresso_read"   on public.progresso_modulos;
drop policy if exists "progresso_insert" on public.progresso_modulos;
drop policy if exists "progresso_update" on public.progresso_modulos;
create policy "progresso_read" on public.progresso_modulos for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
  or exists (
    select 1 from public.clientes c, public.profiles p
    where c.id = progresso_modulos.cliente_id and p.id = auth.uid() and lower(c.email) = lower(p.email)
  )
);
create policy "progresso_insert" on public.progresso_modulos for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
  or exists (
    select 1 from public.clientes c, public.profiles p
    where c.id = progresso_modulos.cliente_id and p.id = auth.uid() and lower(c.email) = lower(p.email)
  )
);
create policy "progresso_update" on public.progresso_modulos for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
  or exists (
    select 1 from public.clientes c, public.profiles p
    where c.id = progresso_modulos.cliente_id and p.id = auth.uid() and lower(c.email) = lower(p.email)
  )
);


-- ── 7. TRIGGERS updated_at ───────────────────────────────────
-- Reusa a função update_updated_at() criada no schema_completo.sql
drop trigger if exists cursos_upd on public.cursos;
drop trigger if exists modulos_upd on public.modulos;
drop trigger if exists progresso_upd on public.progresso_modulos;
create trigger cursos_upd    before update on public.cursos            for each row execute procedure update_updated_at();
create trigger modulos_upd   before update on public.modulos           for each row execute procedure update_updated_at();
create trigger progresso_upd before update on public.progresso_modulos for each row execute procedure update_updated_at();


-- ── 8. SEED OPCIONAL (cursos do catálogo Outliers) ───────────
-- Descomente se quiser popular com os cursos padrão da casa.
-- insert into public.cursos (nome, slug, descricao, duracao_horas, ordem, ativo) values
--   ('Método Cash',                       'metodo-cash',       'Treinamento presencial de 2 dias sobre estrutura financeira.', 16, 1, true),
--   ('PQV — O Pensamento que Vende',      'pqv',               'Treinamento presencial de 2 dias sobre venda consultiva.',     16, 2, true),
--   ('Speakers Play',                     'speakers-play',     'Treinamento presencial de 3 dias sobre oratória e palco.',     24, 3, true),
--   ('ERV — Empresário Vida Real',        'erv',               'Treinamento presencial de 3 dias sobre operação de negócio.', 24, 4, true),
--   ('CILC — Liderança e Coaching',       'cilc',              'Certificação internacional de 4 dias.',                        32, 5, true)
-- on conflict (slug) do nothing;


-- ── 9. VERIFICAÇÃO ───────────────────────────────────────────
-- select
--   (select count(*) from public.cursos)             as cursos,
--   (select count(*) from public.modulos)            as modulos,
--   (select count(*) from public.matriculas)         as matriculas,
--   (select count(*) from public.progresso_modulos)  as progressos;
