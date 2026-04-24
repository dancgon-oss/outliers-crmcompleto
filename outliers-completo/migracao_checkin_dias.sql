-- ============================================================
--  MIGRAÇÃO v6 — Check-in multi-dia + envios de QR
--  Execute no SQL Editor do Supabase
--  Não destrutiva + idempotente (pode rodar de novo)
--  Compatível com PostgreSQL 14+
-- ============================================================

-- ── 1. CHECK-IN POR DIA ──────────────────────────────────────
-- Uma linha por (participante × dia do evento). Permite rastrear
-- presença em eventos de múltiplos dias (Paradigma 3d, CILC 4d, etc.)
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

-- Backfill: para todo participante com checkin_at, cria registro
-- em checkin_dias usando a data_inicio do evento correspondente.
insert into public.checkin_dias (participante_id, dia, checkin_at, checkin_por)
select
  p.id,
  e.data_inicio,
  p.checkin_at,
  p.checkin_por
from public.participantes p
join public.eventos e on e.id = p.evento_id
where p.checkin_at is not null
on conflict (participante_id, dia) do nothing;


-- ── 2. LOG DE ENVIOS DE QR VIA WHATSAPP ──────────────────────
-- Rastreia cada tentativa/sucesso/falha de envio do QR por WhatsApp.
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

-- Marca no participante se o QR já foi enviado (UI rápida)
alter table public.participantes
  add column if not exists qr_enviado_em timestamptz;


-- ── 3. VERIFICAÇÃO ───────────────────────────────────────────
-- select
--   (select count(*) from public.checkin_dias) as total_checkins_dia,
--   (select count(*) from public.envios_qr)    as total_envios_qr;
