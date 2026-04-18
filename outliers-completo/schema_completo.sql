-- ============================================================
--  OUTLIERS CRM — Schema Completo (v3)
--  Execute TODO este arquivo no SQL Editor do Supabase
--  Inclui: CRM, Eventos, Check-in, Contratos, Asaas, Webhooks
-- ============================================================

-- ── 1. PERFIS DE USUÁRIO ─────────────────────────────────────
create table if not exists public.profiles (
  id        uuid references auth.users on delete cascade primary key,
  nome      text not null,
  email     text not null,
  role      text not null default 'operacional' check (role in ('admin','operacional')),
  created_at timestamptz default now()
);

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 2. EVENTOS ───────────────────────────────────────────────
create table if not exists public.eventos (
  id          uuid default gen_random_uuid() primary key,
  nome        text not null,
  tipo        text not null default 'Paradigma' check (tipo in ('Paradigma','Outro')),
  data_inicio date not null,
  data_fim    date,
  local       text,
  descricao   text,
  status      text not null default 'Planejado' check (status in ('Planejado','Em Andamento','Encerrado')),
  criado_por  uuid references public.profiles(id),
  created_at  timestamptz default now()
);

-- ── 3. CLIENTES ──────────────────────────────────────────────
create table if not exists public.clientes (
  id                 uuid default gen_random_uuid() primary key,
  nome               text not null,
  email              text,
  telefone           text,
  cpf                text,
  origem             text not null check (origem in ('Paradigma','Indicação','Renovação','Outro')),
  status             text not null default 'Ativo' check (status in ('Ativo','Inadimplente','Concluído','Inativo')),
  programa           text not null default 'Outliers',
  edicao             text,
  observacoes        text,
  data_entrada       date default current_date,
  evento_origem_id   uuid references public.eventos(id),
  asaas_customer_id  text unique,
  criado_por         uuid references public.profiles(id),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ── 4. PARTICIPANTES DO EVENTO ───────────────────────────────
create table if not exists public.participantes (
  id          uuid default gen_random_uuid() primary key,
  evento_id   uuid references public.eventos(id) on delete cascade not null,
  nome        text not null,
  email       text,
  telefone    text not null,
  cpf         text,
  qr_token    text unique not null default gen_random_uuid()::text,
  checkin_at  timestamptz,
  checkin_por uuid references public.profiles(id),
  cliente_id  uuid references public.clientes(id),
  comprou     boolean default false,
  created_at  timestamptz default now()
);

-- ── 5. FINANCEIRO ────────────────────────────────────────────
create table if not exists public.financeiro (
  id              uuid default gen_random_uuid() primary key,
  cliente_id      uuid references public.clientes(id) on delete cascade not null,
  modalidade      text not null check (modalidade in ('Parcelado','À Vista')),
  valor_total     numeric(10,2) not null,
  desconto        numeric(10,2) default 0,
  forma_pagamento text not null check (forma_pagamento in ('PIX','Cartão','Boleto','Asaas')),
  created_at      timestamptz default now()
);

-- ── 6. PARCELAS ──────────────────────────────────────────────
create table if not exists public.parcelas (
  id                   uuid default gen_random_uuid() primary key,
  financeiro_id        uuid references public.financeiro(id) on delete cascade not null,
  numero               integer not null,
  valor                numeric(10,2) not null,
  vencimento           date,
  status               text not null default 'Pendente' check (status in ('Pago','Pendente','Atrasado')),
  -- Campos Asaas
  asaas_payment_id     text unique,
  asaas_status         text,
  asaas_boleto_url     text,
  asaas_boleto_codigo  text,
  asaas_pix_copia_cola text,
  asaas_pix_qrcode     text,
  asaas_invoice_url    text,
  pago_em              timestamptz,
  updated_at           timestamptz default now()
);

-- ── 7. HISTÓRICO / RENEGOCIAÇÕES ─────────────────────────────
create table if not exists public.historico (
  id          uuid default gen_random_uuid() primary key,
  cliente_id  uuid references public.clientes(id) on delete cascade not null,
  descricao   text not null,
  data        date default current_date,
  criado_por  uuid references public.profiles(id),
  created_at  timestamptz default now()
);

-- ── 8. CONTRATOS DIGITAIS ────────────────────────────────────
create table if not exists public.contratos (
  id                uuid default gen_random_uuid() primary key,
  cliente_id        uuid references public.clientes(id) on delete cascade not null,
  financeiro_id     uuid references public.financeiro(id),
  participante_id   uuid references public.participantes(id),
  texto_contrato    text not null,
  assinado          boolean default false,
  assinado_at       timestamptz,
  assinatura_dados  text,
  ip_assinatura     text,
  created_at        timestamptz default now()
);

-- ── 9. LOGS DE WEBHOOK ───────────────────────────────────────
create table if not exists public.webhook_logs (
  id               uuid default gen_random_uuid() primary key,
  evento           text not null,
  asaas_payment_id text,
  parcela_id       uuid references public.parcelas(id),
  status_novo      text,
  payload          jsonb,
  created_at       timestamptz default now()
);

-- ── ÍNDICES ──────────────────────────────────────────────────
create index if not exists idx_parcelas_asaas        on public.parcelas(asaas_payment_id);
create index if not exists idx_clientes_asaas        on public.clientes(asaas_customer_id);
create index if not exists idx_participantes_token   on public.participantes(qr_token);
create index if not exists idx_participantes_evento  on public.participantes(evento_id);
create index if not exists idx_parcelas_financeiro   on public.parcelas(financeiro_id);
create index if not exists idx_historico_cliente     on public.historico(cliente_id);
create index if not exists idx_contratos_cliente     on public.contratos(cliente_id);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.eventos        enable row level security;
alter table public.clientes       enable row level security;
alter table public.participantes  enable row level security;
alter table public.financeiro     enable row level security;
alter table public.parcelas       enable row level security;
alter table public.historico      enable row level security;
alter table public.contratos      enable row level security;
alter table public.webhook_logs   enable row level security;

-- Profiles
create policy if not exists "profiles_own"   on public.profiles for select using (auth.uid() = id);
create policy if not exists "profiles_admin" on public.profiles for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Todas as outras tabelas: autenticados leem/escrevem; delete só admin
do $$ 
declare t text;
begin
  foreach t in array array['eventos','clientes','participantes','financeiro','parcelas','historico','contratos'] loop
    execute format('
      create policy if not exists "%s_read"   on public.%s for select using (auth.role() = ''authenticated'');
      create policy if not exists "%s_insert" on public.%s for insert with check (auth.role() = ''authenticated'');
      create policy if not exists "%s_update" on public.%s for update using (auth.role() = ''authenticated'');
      create policy if not exists "%s_delete" on public.%s for delete using (
        exists (select 1 from public.profiles where id = auth.uid() and role = ''admin'')
      );
    ', t, t, t, t, t, t, t, t);
  end loop;
end $$;

-- Webhook logs: só admin lê
create policy if not exists "wh_admin" on public.webhook_logs for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy if not exists "wh_insert" on public.webhook_logs for insert with check (true);

-- ── TRIGGERS updated_at ──────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists clientes_upd  on public.clientes;
drop trigger if exists parcelas_upd  on public.parcelas;
create trigger clientes_upd  before update on public.clientes  for each row execute procedure update_updated_at();
create trigger parcelas_upd  before update on public.parcelas  for each row execute procedure update_updated_at();
