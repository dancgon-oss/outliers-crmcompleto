-- ============================================================
--  CONTRATOS x ZapSign
--  Adiciona colunas para integracao com ZapSign na tabela
--  `contratos` (ja existente). Idempotente.
-- ============================================================

alter table public.contratos add column if not exists financeiro_id      uuid references public.financeiro(id) on delete cascade;
alter table public.contratos add column if not exists zapsign_doc_id     text;
alter table public.contratos add column if not exists zapsign_doc_token  text;
alter table public.contratos add column if not exists link_assinatura    text;
alter table public.contratos add column if not exists pdf_original_url   text;
alter table public.contratos add column if not exists pdf_assinado_url   text;
alter table public.contratos add column if not exists signer_email       text;
alter table public.contratos add column if not exists signer_nome        text;
alter table public.contratos add column if not exists status             text default 'Aguardando';
alter table public.contratos add column if not exists enviado_em         timestamptz;
alter table public.contratos add column if not exists recusado_em        timestamptz;
alter table public.contratos add column if not exists payload_zapsign    jsonb;

create index if not exists contratos_zapsign_doc_idx  on public.contratos (zapsign_doc_id);
create index if not exists contratos_financeiro_idx   on public.contratos (financeiro_id);
create index if not exists contratos_cliente_idx      on public.contratos (cliente_id);
create index if not exists contratos_status_idx       on public.contratos (status);

-- RLS
alter table public.contratos enable row level security;

drop policy if exists "contratos_read"   on public.contratos;
drop policy if exists "contratos_insert" on public.contratos;
drop policy if exists "contratos_update" on public.contratos;
drop policy if exists "contratos_delete" on public.contratos;

create policy "contratos_read" on public.contratos for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "contratos_insert" on public.contratos for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "contratos_update" on public.contratos for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro','comercial'))
);
create policy "contratos_delete" on public.contratos for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','financeiro'))
);
