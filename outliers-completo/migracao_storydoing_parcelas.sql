-- ============================================================
--  STORYDOING: parcelas das locacoes
--  Suporte a pagamento em multiplas parcelas, cada uma com
--  forma + data + comprovante proprios. Idempotente.
-- ============================================================

create table if not exists public.storydoing_parcelas (
  id                uuid primary key default gen_random_uuid(),
  locacao_id        uuid not null references public.storydoing_locacoes(id) on delete cascade,
  numero            int  not null,
  valor             numeric(12,2) not null,
  vencimento        date,
  status            text not null default 'Pendente'
                     check (status in ('Pendente','Pago','Atrasado','Cancelado')),
  pago_em           date,
  forma_pagamento   text,
  comprovante_url   text,
  comprovante_nome  text,
  observacoes       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sd_parc_locacao_idx on public.storydoing_parcelas (locacao_id);
create index if not exists sd_parc_status_idx  on public.storydoing_parcelas (status, vencimento);

alter table public.storydoing_parcelas enable row level security;

drop policy if exists "sdp_read"   on public.storydoing_parcelas;
drop policy if exists "sdp_insert" on public.storydoing_parcelas;
drop policy if exists "sdp_update" on public.storydoing_parcelas;
drop policy if exists "sdp_delete" on public.storydoing_parcelas;

create policy "sdp_read"   on public.storydoing_parcelas for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sdp_insert" on public.storydoing_parcelas for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sdp_update" on public.storydoing_parcelas for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sdp_delete" on public.storydoing_parcelas for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);

-- Trigger: atualiza status_pagamento da locacao baseado nas parcelas
create or replace function public.tg_sd_sync_locacao_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc_id uuid;
  v_total int;
  v_pagas int;
begin
  v_loc_id := coalesce(NEW.locacao_id, OLD.locacao_id);
  if v_loc_id is null then return coalesce(NEW, OLD); end if;
  select count(*), count(*) filter (where status = 'Pago')
    into v_total, v_pagas
    from public.storydoing_parcelas where locacao_id = v_loc_id;
  if v_total = 0 then return coalesce(NEW, OLD); end if;
  if v_pagas = v_total then
    update public.storydoing_locacoes set status_pagamento = 'Pago', updated_at = now() where id = v_loc_id;
  elsif v_pagas > 0 then
    -- pagamento parcial: deixa como Pendente mas considera proporcional
    update public.storydoing_locacoes set status_pagamento = 'Pendente', updated_at = now() where id = v_loc_id;
  else
    update public.storydoing_locacoes set status_pagamento = 'Pendente', updated_at = now() where id = v_loc_id;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists tg_sd_sync_locacao_status_trg on public.storydoing_parcelas;
create trigger tg_sd_sync_locacao_status_trg
  after insert or update or delete on public.storydoing_parcelas
  for each row execute function public.tg_sd_sync_locacao_status();

-- Trigger: atualiza updated_at da parcela
create or replace function public.tg_sd_parc_upd()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;
drop trigger if exists tg_sd_parc_upd_trg on public.storydoing_parcelas;
create trigger tg_sd_parc_upd_trg
  before update on public.storydoing_parcelas
  for each row execute function public.tg_sd_parc_upd();
