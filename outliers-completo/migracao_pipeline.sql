-- ============================================================
--  MIGRAÇÃO v8 — Pipeline comercial (Kanban de leads)
--  Execute no SQL Editor do Supabase
--  Não destrutiva
-- ============================================================

-- ── 1. Campos novos em clientes ──────────────────────────────
-- stage: estágio no funil de vendas (null = não está no pipeline)
-- responsavel_id: comercial responsável por esse lead
alter table public.clientes
  add column if not exists stage text
    check (stage is null or stage in ('Novo','Em contato','Proposta','Ganho','Perdido'));

alter table public.clientes
  add column if not exists responsavel_id uuid references public.profiles(id);

alter table public.clientes
  add column if not exists ultimo_contato timestamptz;  -- última interação registrada

create index if not exists idx_clientes_stage on public.clientes(stage) where stage is not null;
create index if not exists idx_clientes_responsavel on public.clientes(responsavel_id);


-- ── 2. Histórico de movimentação no funil ────────────────────
create table if not exists public.lead_stage_history (
  id           uuid default gen_random_uuid() primary key,
  cliente_id   uuid references public.clientes(id) on delete cascade not null,
  stage_from   text,                        -- pode ser null (entrada no funil)
  stage_to     text not null,
  movido_por   uuid references public.profiles(id),
  observacao   text,
  created_at   timestamptz default now()
);

create index if not exists idx_lsh_cliente on public.lead_stage_history(cliente_id);
create index if not exists idx_lsh_data on public.lead_stage_history(created_at desc);

alter table public.lead_stage_history enable row level security;

drop policy if exists "lsh_read" on public.lead_stage_history;
drop policy if exists "lsh_insert" on public.lead_stage_history;
create policy "lsh_read" on public.lead_stage_history for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial','financeiro'))
);
create policy "lsh_insert" on public.lead_stage_history for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','comercial'))
);


-- ── 3. Trigger: grava histórico automaticamente ao mudar stage ──
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


-- ── 4. Backfill (opcional): leads captados pela landing ───────
-- Marca clientes com origem='Outro' e observacoes contendo 'landing=' como stage='Novo'.
-- Leads do agente IA (origem='Paradigma', observacoes contendo 'Agente IA') também.
update public.clientes
set stage = 'Novo'
where stage is null
  and status = 'Ativo'
  and (
    coalesce(observacoes, '') ilike '%landing=%'
    or coalesce(observacoes, '') ilike '%agente%'
  );


-- ── 5. VERIFICAÇÃO ───────────────────────────────────────────
-- select stage, count(*) from public.clientes where stage is not null group by stage;
-- select count(*) from public.lead_stage_history;
