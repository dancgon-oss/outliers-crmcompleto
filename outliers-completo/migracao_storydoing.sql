-- ============================================================
--  STORYDOING: locacoes das salas Black e White
--  Idempotente.
-- ============================================================

create table if not exists public.storydoing_locacoes (
  id                  uuid primary key default gen_random_uuid(),
  sala                text not null check (sala in ('black','white')),
  data_locacao        date not null,
  hora_inicio         time,
  hora_fim            time,
  valor               numeric(12,2) not null,
  locador_nome        text not null,
  locador_telefone    text,
  locador_email       text,
  locador_documento   text,
  responsavel_id      uuid references public.profiles(id),
  responsavel_nome    text,                  -- snapshot pro caso do profile mudar
  comissao_percentual numeric(5,2) default 0,
  comissao_valor      numeric(12,2) default 0,
  comissao_paga       boolean not null default false,
  comissao_paga_em    date,
  forma_pagamento     text check (forma_pagamento in ('PIX','Cartão','Boleto','Dinheiro','Transferência') or forma_pagamento is null),
  data_pagamento      date,
  status_pagamento    text not null default 'Pendente'
                       check (status_pagamento in ('Pendente','Pago','Cancelado','Reembolsado')),
  comprovante_url     text,
  comprovante_nome    text,
  observacoes         text,
  criado_por          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists storydoing_data_idx           on public.storydoing_locacoes (data_locacao desc);
create index if not exists storydoing_status_idx         on public.storydoing_locacoes (status_pagamento);
create index if not exists storydoing_sala_idx           on public.storydoing_locacoes (sala);
create index if not exists storydoing_responsavel_idx    on public.storydoing_locacoes (responsavel_id);

alter table public.storydoing_locacoes enable row level security;

drop policy if exists "sd_read"   on public.storydoing_locacoes;
drop policy if exists "sd_insert" on public.storydoing_locacoes;
drop policy if exists "sd_update" on public.storydoing_locacoes;
drop policy if exists "sd_delete" on public.storydoing_locacoes;

create policy "sd_read"   on public.storydoing_locacoes for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sd_insert" on public.storydoing_locacoes for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sd_update" on public.storydoing_locacoes for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sd_delete" on public.storydoing_locacoes for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);

-- Trigger pra atualizar updated_at + calcular comissao_valor automaticamente
create or replace function public.tg_storydoing_calc()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  NEW.comissao_valor = round((coalesce(NEW.valor,0) * coalesce(NEW.comissao_percentual,0) / 100)::numeric, 2);
  return NEW;
end;
$$;

drop trigger if exists tg_storydoing_calc_trg on public.storydoing_locacoes;
create trigger tg_storydoing_calc_trg
  before insert or update on public.storydoing_locacoes
  for each row execute function public.tg_storydoing_calc();

-- ============================================================
-- STORAGE: cria bucket privado para comprovantes
-- ============================================================
insert into storage.buckets (id, name, public)
values ('storydoing-comprovantes', 'storydoing-comprovantes', false)
on conflict (id) do nothing;

-- Policies do bucket
drop policy if exists "sd_storage_read"   on storage.objects;
drop policy if exists "sd_storage_insert" on storage.objects;
drop policy if exists "sd_storage_update" on storage.objects;
drop policy if exists "sd_storage_delete" on storage.objects;

create policy "sd_storage_read" on storage.objects for select using (
  bucket_id = 'storydoing-comprovantes'
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sd_storage_insert" on storage.objects for insert with check (
  bucket_id = 'storydoing-comprovantes'
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sd_storage_update" on storage.objects for update using (
  bucket_id = 'storydoing-comprovantes'
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "sd_storage_delete" on storage.objects for delete using (
  bucket_id = 'storydoing-comprovantes'
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);
