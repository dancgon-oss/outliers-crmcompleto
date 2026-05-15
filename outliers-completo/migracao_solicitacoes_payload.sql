-- ============================================================
--  SOLICITAÇÕES: payload estruturado + executor automático
--  Tipo da solicitação define os campos. Admin aprova → sistema
--  cria automaticamente no CRM (cliente, conta, locação, etc).
-- ============================================================

alter table public.solicitacoes
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists resultado jsonb default '{}'::jsonb,
  add column if not exists executado_em timestamptz,
  add column if not exists executado_por uuid references public.profiles(id) on delete set null;

-- Função executa a solicitação baseado no tipo, retorna jsonb com resultado
create or replace function public.executar_solicitacao(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  p jsonb;
  v_id uuid;
  v_role text;
  v_result jsonb;
begin
  -- Permissão: só staff aprova
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','comercial','financeiro','operacional') then
    return jsonb_build_object('ok', false, 'error', 'Apenas staff pode aprovar solicitações.');
  end if;

  select * into s from public.solicitacoes where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada.');
  end if;
  if s.status = 'Concluida' then
    return jsonb_build_object('ok', false, 'error', 'Solicitação já foi executada.');
  end if;

  p := coalesce(s.payload, '{}'::jsonb);

  if s.tipo = 'cliente_novo' then
    -- Cria cliente
    if coalesce(p->>'nome','') = '' then
      return jsonb_build_object('ok', false, 'error', 'Nome do cliente obrigatório no payload.');
    end if;
    insert into public.clientes (nome, email, telefone, cpf, origem, programa, status, stage, data_entrada, criado_por, observacoes)
    values (
      p->>'nome',
      nullif(p->>'email', ''),
      regexp_replace(coalesce(p->>'telefone',''), '\D', '', 'g'),
      regexp_replace(coalesce(p->>'cpf',''), '\D', '', 'g'),
      coalesce(p->>'origem', 'Solicitação'),
      coalesce(p->>'programa', 'Paradigma'),
      'Ativo',
      'Novo',
      current_date,
      s.criado_por,
      coalesce(p->>'observacoes', null)
    ) returning id into v_id;
    v_result := jsonb_build_object('cliente_id', v_id);

  elsif s.tipo = 'conta_pagar' then
    if coalesce(p->>'descricao','') = '' then
      return jsonb_build_object('ok', false, 'error', 'Descrição obrigatória.');
    end if;
    insert into public.contas_pagar (descricao, fornecedor, categoria, valor, vencimento, forma_pagamento, observacoes, origem, criado_por, status)
    values (
      p->>'descricao',
      nullif(p->>'fornecedor', ''),
      nullif(p->>'categoria', ''),
      coalesce((p->>'valor')::numeric, 0),
      coalesce((p->>'vencimento')::date, current_date),
      nullif(p->>'forma_pagamento', ''),
      nullif(p->>'observacoes', ''),
      coalesce(p->>'origem', 'Outliers'),
      s.criado_por,
      'Pendente'
    ) returning id into v_id;
    v_result := jsonb_build_object('conta_id', v_id);

  elsif s.tipo = 'locacao_nova' then
    if coalesce(p->>'sala','') not in ('black','white') then
      return jsonb_build_object('ok', false, 'error', 'Sala deve ser "black" ou "white".');
    end if;
    insert into public.storydoing_locacoes (sala, data_locacao, data_fim, hora_inicio, hora_fim, valor, locador_nome, locador_telefone, locador_email, observacoes, criado_por, status_pagamento)
    values (
      p->>'sala',
      coalesce((p->>'data_locacao')::date, current_date),
      nullif(p->>'data_fim','')::date,
      nullif(p->>'hora_inicio','')::time,
      nullif(p->>'hora_fim','')::time,
      coalesce((p->>'valor')::numeric, 0),
      coalesce(p->>'locador_nome', 'Locador'),
      regexp_replace(coalesce(p->>'locador_telefone',''), '\D', '', 'g'),
      nullif(p->>'locador_email', ''),
      nullif(p->>'observacoes', ''),
      s.criado_por,
      'Pendente'
    ) returning id into v_id;
    v_result := jsonb_build_object('locacao_id', v_id);

  elsif s.tipo = 'venda_nova' then
    if coalesce(p->>'cliente_id','') = '' or coalesce((p->>'valor_total')::numeric, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'cliente_id e valor_total obrigatórios.');
    end if;
    insert into public.financeiro (cliente_id, curso_id, modalidade, valor_total, desconto, forma_pagamento, criado_por)
    values (
      (p->>'cliente_id')::uuid,
      nullif(p->>'curso_id','')::uuid,
      coalesce(p->>'modalidade', 'Parcelado'),
      (p->>'valor_total')::numeric,
      coalesce((p->>'desconto')::numeric, 0),
      nullif(p->>'forma_pagamento', ''),
      s.criado_por
    ) returning id into v_id;
    v_result := jsonb_build_object('financeiro_id', v_id);

  else
    -- Outros tipos (relatorio, informacao, outro) = não executa automaticamente, só fecha como Concluída
    v_result := jsonb_build_object('manual', true, 'note', 'Tipo de solicitação sem execução automática');
  end if;

  -- Atualiza solicitação
  update public.solicitacoes set
    status = 'Concluida',
    resultado = v_result,
    executado_em = now(),
    executado_por = auth.uid(),
    fechado_em = now(),
    fechado_por = auth.uid(),
    updated_at = now()
  where id = p_id;

  -- Adiciona mensagem automática no chat
  insert into public.solicitacao_mensagens (solicitacao_id, autor_id, autor_nome, texto)
  values (p_id, auth.uid(),
    (select nome from public.profiles where id = auth.uid()),
    '✅ Solicitação aprovada e executada. Resultado: ' || v_result::text);

  return jsonb_build_object('ok', true, 'resultado', v_result);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.executar_solicitacao(uuid) to authenticated, service_role;
