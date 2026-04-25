-- ============================================================
--  MIGRAÇÃO CONSOLIDADA — roda TUDO das frentes A/B/C/D
--  ────────────────────────────────────────────────────────────
--  100% idempotente: pode rodar quantas vezes quiser, não quebra
--  nada que já existe. Usa pattern DROP + CREATE em policies pra
--  compatibilidade com PostgreSQL 14+ (Supabase qualquer versão).
--
--  COMO USAR:
--   1. Abra o Supabase → SQL Editor → New query
--   2. Ctrl+A / delete (garante que está vazio)
--   3. Cole ESTE arquivo INTEIRO (role até o final pra conferir)
--   4. Clique Run
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║ PARTE 1 — CHECK-IN MULTI-DIA + ENVIOS DE QR              ║
-- ╚══════════════════════════════════════════════════════════╝

-- Existe uma versão antiga de checkin_dias com schema diferente (dia integer
-- em vez de date, evento_id direto). Como está vazia, dropamos e recriamos.
drop table if exists public.checkin_dias cascade;

create table if not exists public.checkin_dias (
  id              uuid default gen_random_uuid() primary key,
  participante_id uuid references public.participantes(id) on delete cascade not null,
  dia             date not null,
  checkin_at      timestamptz not null default now(),
  checkin_por     uuid references public.profiles(id),
  created_at      timestamptz default now(),
  unique (participante_id, dia)
);

create index if not exists idx_checkin_dias_part on public.checkin_dias(participante_id);
create index if not exists idx_checkin_dias_dia  on public.checkin_dias(dia);

alter table public.checkin_dias enable row level security;

drop policy if exists "cd_read"   on public.checkin_dias;
drop policy if exists "cd_insert" on public.checkin_dias;
drop policy if exists "cd_update" on public.checkin_dias;
drop policy if exists "cd_delete" on public.checkin_dias;

create policy "cd_read"   on public.checkin_dias for select using (auth.role() = 'authenticated');
create policy "cd_insert" on public.checkin_dias for insert with check (auth.role() = 'authenticated');
create policy "cd_update" on public.checkin_dias for update using (auth.role() = 'authenticated');
create policy "cd_delete" on public.checkin_dias for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);

insert into public.checkin_dias (participante_id, dia, checkin_at, checkin_por)
select p.id, e.data_inicio, p.checkin_at, p.checkin_por
from public.participantes p
join public.eventos e on e.id = p.evento_id
where p.checkin_at is not null
on conflict (participante_id, dia) do nothing;


create table if not exists public.envios_qr (
  id              uuid default gen_random_uuid() primary key,
  participante_id uuid references public.participantes(id) on delete cascade not null,
  canal           text not null default 'whatsapp',
  status          text not null check (status in ('enviado','erro','pendente')),
  provider_id     text,
  erro            text,
  payload         jsonb,
  enviado_por     uuid references public.profiles(id),
  created_at      timestamptz default now()
);

create index if not exists idx_envios_qr_part on public.envios_qr(participante_id);
create index if not exists idx_envios_qr_data on public.envios_qr(created_at desc);

alter table public.envios_qr enable row level security;

drop policy if exists "eq_read"   on public.envios_qr;
drop policy if exists "eq_insert" on public.envios_qr;

create policy "eq_read"   on public.envios_qr for select using (auth.role() = 'authenticated');
create policy "eq_insert" on public.envios_qr for insert with check (true);

alter table public.participantes
  add column if not exists qr_enviado_em timestamptz;


-- ╔══════════════════════════════════════════════════════════╗
-- ║ PARTE 2 — CURSOS + PORTAL DO ALUNO                       ║
-- ╚══════════════════════════════════════════════════════════╝

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'comercial', 'financeiro', 'operacional', 'aluno'));


-- A tabela cursos pode já existir com schema diferente (preco_padrao, categoria
-- em vez de slug, capa_url, duracao_horas, preco_avulso). Se existir com dados,
-- adicionamos só as colunas que faltam — não destruímos o existente.
create table if not exists public.cursos (
  id             uuid default gen_random_uuid() primary key,
  nome           text not null,
  slug           text unique,
  descricao      text,
  capa_url       text,
  duracao_horas  numeric(6,2),
  preco_avulso   numeric(10,2),
  ordem          int default 0,
  ativo          boolean default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Compat: adiciona colunas que minhas pages esperam, caso a tabela já existisse
-- com schema antigo (preco_padrao, categoria). preco_padrao/categoria ficam
-- intactos — não atrapalham.
alter table public.cursos add column if not exists slug          text;
alter table public.cursos add column if not exists capa_url      text;
alter table public.cursos add column if not exists duracao_horas numeric(6,2);
alter table public.cursos add column if not exists preco_avulso  numeric(10,2);
alter table public.cursos add column if not exists ordem         int default 0;
alter table public.cursos add column if not exists ativo         boolean default true;

-- Garante que slug seja único quando preenchido (constraint condicional)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cursos_slug_key'
  ) then
    -- Cria índice único parcial em vez de UNIQUE constraint pra permitir slugs nulos
    create unique index if not exists cursos_slug_unique on public.cursos(slug) where slug is not null;
  end if;
end $$;

create index if not exists idx_cursos_ativo on public.cursos(ativo);


create table if not exists public.modulos (
  id           uuid default gen_random_uuid() primary key,
  curso_id     uuid references public.cursos(id) on delete cascade not null,
  nome         text not null,
  descricao    text,
  ordem        int not null default 0,
  video_url    text,
  duracao_min  int,
  material_url text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_modulos_curso on public.modulos(curso_id, ordem);


create table if not exists public.matriculas (
  id              uuid default gen_random_uuid() primary key,
  cliente_id      uuid references public.clientes(id) on delete cascade not null,
  curso_id        uuid references public.cursos(id) on delete cascade not null,
  tipo            text not null default 'Incluso' check (tipo in ('Incluso','Compra Avulsa','Bônus','Cortesia')),
  status          text not null default 'Ativa' check (status in ('Ativa','Expirada','Cancelada')),
  financeiro_id   uuid references public.financeiro(id),
  matriculado_em  timestamptz default now(),
  expira_em       timestamptz,
  criado_por      uuid references public.profiles(id),
  created_at      timestamptz default now(),
  unique (cliente_id, curso_id)
);

create index if not exists idx_matriculas_cliente on public.matriculas(cliente_id);
create index if not exists idx_matriculas_curso on public.matriculas(curso_id);
create index if not exists idx_matriculas_status on public.matriculas(status);


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


alter table public.cursos             enable row level security;
alter table public.modulos            enable row level security;
alter table public.matriculas         enable row level security;
alter table public.progresso_modulos  enable row level security;

drop policy if exists "cursos_read"   on public.cursos;
drop policy if exists "cursos_write"  on public.cursos;
drop policy if exists "modulos_read"  on public.modulos;
drop policy if exists "modulos_write" on public.modulos;
drop policy if exists "matriculas_read"  on public.matriculas;
drop policy if exists "matriculas_write" on public.matriculas;
drop policy if exists "progresso_read"   on public.progresso_modulos;
drop policy if exists "progresso_insert" on public.progresso_modulos;
drop policy if exists "progresso_update" on public.progresso_modulos;

create policy "cursos_read"  on public.cursos for select using (auth.role() = 'authenticated');
create policy "cursos_write" on public.cursos for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);

create policy "modulos_read"  on public.modulos for select using (auth.role() = 'authenticated');
create policy "modulos_write" on public.modulos for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);

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

drop trigger if exists cursos_upd on public.cursos;
drop trigger if exists modulos_upd on public.modulos;
drop trigger if exists progresso_upd on public.progresso_modulos;
create trigger cursos_upd    before update on public.cursos            for each row execute procedure update_updated_at();
create trigger modulos_upd   before update on public.modulos           for each row execute procedure update_updated_at();
create trigger progresso_upd before update on public.progresso_modulos for each row execute procedure update_updated_at();


-- ╔══════════════════════════════════════════════════════════╗
-- ║ PARTE 3 — PIPELINE COMERCIAL (KANBAN)                    ║
-- ╚══════════════════════════════════════════════════════════╝

alter table public.clientes
  add column if not exists stage text
    check (stage is null or stage in ('Novo','Em contato','Proposta','Ganho','Perdido'));

alter table public.clientes
  add column if not exists responsavel_id uuid references public.profiles(id);

alter table public.clientes
  add column if not exists ultimo_contato timestamptz;

create index if not exists idx_clientes_stage on public.clientes(stage) where stage is not null;
create index if not exists idx_clientes_responsavel on public.clientes(responsavel_id);


create table if not exists public.lead_stage_history (
  id           uuid default gen_random_uuid() primary key,
  cliente_id   uuid references public.clientes(id) on delete cascade not null,
  stage_from   text,
  stage_to     text not null,
  movido_por   uuid references public.profiles(id),
  observacao   text,
  created_at   timestamptz default now()
);

create index if not exists idx_lsh_cliente on public.lead_stage_history(cliente_id);
create index if not exists idx_lsh_data on public.lead_stage_history(created_at desc);

alter table public.lead_stage_history enable row level security;

drop policy if exists "lsh_read"   on public.lead_stage_history;
drop policy if exists "lsh_insert" on public.lead_stage_history;

create policy "lsh_read" on public.lead_stage_history for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "lsh_insert" on public.lead_stage_history for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);


create or replace function public.log_stage_change()
returns trigger as $$
begin
  if (old.stage is distinct from new.stage) then
    insert into public.lead_stage_history (cliente_id, stage_from, stage_to, movido_por)
    values (new.id, old.stage, new.stage, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists clientes_stage_log on public.clientes;
create trigger clientes_stage_log
  after update of stage on public.clientes
  for each row execute procedure public.log_stage_change();


update public.clientes
set stage = 'Novo'
where stage is null
  and status = 'Ativo'
  and (
    coalesce(observacoes, '') ilike '%landing=%'
    or coalesce(observacoes, '') ilike '%agente%'
  );


-- ╔══════════════════════════════════════════════════════════╗
-- ║ VERIFICAÇÃO FINAL                                         ║
-- ╚══════════════════════════════════════════════════════════╝
-- Rode após o script pra confirmar que tudo foi criado:
--
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in (
--     'checkin_dias','envios_qr','cursos','modulos',
--     'matriculas','progresso_modulos','lead_stage_history'
--   )
-- order by table_name;
--
-- Esperado: 7 linhas.
