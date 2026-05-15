-- ============================================================
--  SOLICITAÇÕES: sistema de tickets pra Diretor / Tio Patinhas
--  e outros usuários enviarem pedidos ao time (relatórios,
--  cadastros, locações, contas, etc).
-- ============================================================

-- 1) Adiciona role 'solicitante' na constraint
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','comercial','financeiro','operacional','aluno','storydoing','solicitante'));

-- 2) Tabela de solicitações
create table if not exists public.solicitacoes (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in (
    'cliente_novo','locacao_nova','conta_pagar','relatorio','informacao','outro')),
  assunto       text not null,
  descricao     text,
  prioridade    text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  status        text not null default 'Pendente' check (status in (
    'Pendente','Em andamento','Concluida','Cancelada')),
  criado_por    uuid references auth.users(id) on delete set null,
  atribuido_a   uuid references public.profiles(id) on delete set null,
  fechado_em    timestamptz,
  fechado_por   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists solicit_status_idx     on public.solicitacoes (status, created_at desc);
create index if not exists solicit_criado_por_idx on public.solicitacoes (criado_por);
create index if not exists solicit_atribuido_idx  on public.solicitacoes (atribuido_a);

-- 3) Mensagens (chat) dentro de cada solicitação
create table if not exists public.solicitacao_mensagens (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  autor_id        uuid references public.profiles(id) on delete set null,
  autor_nome      text,
  texto           text not null,
  created_at      timestamptz not null default now()
);

create index if not exists sm_solicit_idx on public.solicitacao_mensagens (solicitacao_id, created_at);

-- 4) RLS
alter table public.solicitacoes enable row level security;
alter table public.solicitacao_mensagens enable row level security;

drop policy if exists "sol_read"   on public.solicitacoes;
drop policy if exists "sol_insert" on public.solicitacoes;
drop policy if exists "sol_update" on public.solicitacoes;
drop policy if exists "sol_delete" on public.solicitacoes;

-- Leitura: staff vê tudo; solicitante vê só as suas
create policy "sol_read" on public.solicitacoes for select using (
  current_user_role() in ('admin','comercial','financeiro','operacional')
  or criado_por = auth.uid()
);
-- Insert: qualquer authenticated cria
create policy "sol_insert" on public.solicitacoes for insert with check (
  auth.uid() is not null
);
-- Update: staff atualiza tudo; solicitante atualiza só status/cancel das suas
create policy "sol_update" on public.solicitacoes for update using (
  current_user_role() in ('admin','comercial','financeiro','operacional')
  or criado_por = auth.uid()
);
-- Delete: só admin
create policy "sol_delete" on public.solicitacoes for delete using (
  current_user_role() = 'admin'
);

-- Mensagens: mesmas regras (visíveis se a solicitação é)
drop policy if exists "sm_read"   on public.solicitacao_mensagens;
drop policy if exists "sm_insert" on public.solicitacao_mensagens;
drop policy if exists "sm_delete" on public.solicitacao_mensagens;

create policy "sm_read" on public.solicitacao_mensagens for select using (
  exists (
    select 1 from public.solicitacoes s
    where s.id = solicitacao_mensagens.solicitacao_id
      and (current_user_role() in ('admin','comercial','financeiro','operacional') or s.criado_por = auth.uid())
  )
);
create policy "sm_insert" on public.solicitacao_mensagens for insert with check (
  exists (
    select 1 from public.solicitacoes s
    where s.id = solicitacao_id
      and (current_user_role() in ('admin','comercial','financeiro','operacional') or s.criado_por = auth.uid())
  )
);
create policy "sm_delete" on public.solicitacao_mensagens for delete using (
  current_user_role() = 'admin'
);

-- 5) Trigger: notifica admin quando solicitação criada
create or replace function public.tg_solicitacao_nova_notif()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_nome text; v_prior_emoji text;
begin
  select nome into v_nome from public.profiles where id = NEW.criado_por;
  v_prior_emoji := case NEW.prioridade when 'urgente' then '🚨' when 'alta' then '⚠️' else '📩' end;
  insert into public.notificacoes (tipo, titulo, mensagem, para_role)
  values (
    'solicitacao_nova',
    v_prior_emoji || ' Nova solicitação de ' || coalesce(v_nome, 'usuário'),
    NEW.assunto || ' (' || NEW.tipo || ')',
    'admin'
  );
  return NEW;
end;
$$;

drop trigger if exists tg_solicit_nova_trg on public.solicitacoes;
create trigger tg_solicit_nova_trg
  after insert on public.solicitacoes
  for each row execute function public.tg_solicitacao_nova_notif();

-- 6) Trigger: notifica solicitante quando uma resposta é adicionada
create or replace function public.tg_solicit_resposta_notif()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicit record;
  v_autor_role text;
begin
  select * into v_solicit from public.solicitacoes where id = NEW.solicitacao_id;
  if not found then return NEW; end if;

  -- Se autor é staff e solicitante é outro, notifica o solicitante
  if NEW.autor_id is not null and NEW.autor_id <> v_solicit.criado_por then
    select role into v_autor_role from public.profiles where id = NEW.autor_id;
    insert into public.notificacoes (tipo, titulo, mensagem, para_role, lida)
    values (
      'solicitacao_resposta',
      '💬 Resposta na sua solicitação',
      v_solicit.assunto || ' — ' || left(NEW.texto, 80),
      coalesce((select role from public.profiles where id = v_solicit.criado_por), 'admin'),
      false
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_solicit_resposta_trg on public.solicitacao_mensagens;
create trigger tg_solicit_resposta_trg
  after insert on public.solicitacao_mensagens
  for each row execute function public.tg_solicit_resposta_notif();

-- 7) Ajusta policy do notificacoes pra solicitante ver as suas
-- (já permite "admin OU role = para_role")
