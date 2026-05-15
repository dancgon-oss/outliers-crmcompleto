-- ============================================================
--  Cria cliente automaticamente quando participante e inserido,
--  com stage='Novo' (entra no Pipeline).
--  Faz lookup pra nao duplicar caso ja exista cliente com mesmo
--  email ou telefone. Inclui migracao retroativa.
-- ============================================================

create or replace function public.tg_participante_to_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id   uuid;
  v_evento_nome  text;
  v_evento_tipo  text;
  v_telefone     text;
  v_email        text;
begin
  -- Se ja vem com cliente_id, nada a fazer
  if NEW.cliente_id is not null then return NEW; end if;

  v_email := nullif(trim(NEW.email), '');
  v_telefone := nullif(trim(NEW.telefone), '');

  -- 1) Procura cliente existente por email
  if v_email is not null then
    select id into v_cliente_id from public.clientes where lower(email) = lower(v_email) limit 1;
  end if;
  -- 2) Senao, procura por telefone (apenas digitos)
  if v_cliente_id is null and v_telefone is not null then
    select id into v_cliente_id from public.clientes
      where regexp_replace(coalesce(telefone,''), '\D', '', 'g') = regexp_replace(v_telefone, '\D', '', 'g')
      limit 1;
  end if;

  -- Se achou, so vincula (sem criar duplicado)
  if v_cliente_id is not null then
    update public.participantes set cliente_id = v_cliente_id where id = NEW.id;
    return NEW;
  end if;

  -- 3) Cria novo cliente com stage='Novo'
  select nome, tipo into v_evento_nome, v_evento_tipo
    from public.eventos where id = NEW.evento_id;

  insert into public.clientes (nome, email, telefone, cpf, origem, status, programa, stage, evento_origem_id, data_entrada)
  values (
    NEW.nome,
    v_email,
    regexp_replace(coalesce(v_telefone,''), '\D', '', 'g'),
    nullif(trim(NEW.cpf), ''),
    coalesce(v_evento_tipo, v_evento_nome, 'Evento'),
    'Ativo',
    coalesce(v_evento_tipo, 'Paradigma'),
    'Novo',
    NEW.evento_id,
    current_date
  ) returning id into v_cliente_id;

  update public.participantes set cliente_id = v_cliente_id where id = NEW.id;
  return NEW;
exception when others then
  -- nao bloqueia o insert do participante caso falhe
  return NEW;
end;
$$;

drop trigger if exists tg_participante_to_cliente_trg on public.participantes;
create trigger tg_participante_to_cliente_trg
  after insert on public.participantes
  for each row execute function public.tg_participante_to_cliente();

-- ============================================================
-- MIGRACAO RETROATIVA: cria/vincula clientes pra todos
-- participantes existentes sem cliente_id.
-- ============================================================
do $$
declare
  rec record;
  v_cliente_id uuid;
  v_evento_nome text;
  v_evento_tipo text;
  v_email text;
  v_telefone text;
begin
  for rec in
    select id, nome, email, telefone, cpf, evento_id
      from public.participantes
     where cliente_id is null
       and nome is not null
  loop
    v_email := nullif(trim(rec.email), '');
    v_telefone := nullif(regexp_replace(coalesce(trim(rec.telefone),''), '\D', '', 'g'), '');
    v_cliente_id := null;

    if v_email is not null then
      select id into v_cliente_id from public.clientes where lower(email) = lower(v_email) limit 1;
    end if;
    if v_cliente_id is null and v_telefone is not null then
      select id into v_cliente_id from public.clientes
        where regexp_replace(coalesce(telefone,''), '\D', '', 'g') = v_telefone limit 1;
    end if;

    if v_cliente_id is null then
      select nome, tipo into v_evento_nome, v_evento_tipo
        from public.eventos where id = rec.evento_id;

      insert into public.clientes (nome, email, telefone, cpf, origem, status, programa, stage, evento_origem_id, data_entrada)
      values (
        rec.nome,
        v_email,
        v_telefone,
        nullif(trim(rec.cpf), ''),
        coalesce(v_evento_tipo, v_evento_nome, 'Evento'),
        'Ativo', coalesce(v_evento_tipo, 'Paradigma'), 'Novo', rec.evento_id, current_date
      ) returning id into v_cliente_id;
    end if;

    update public.participantes set cliente_id = v_cliente_id where id = rec.id;
  end loop;
end $$;
