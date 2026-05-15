-- ============================================================
--  EXCLUSAO SEGURA: cliente / venda (financeiro) / parcela
--  Funcoes RPC que apagam na ordem correta para nao bater em FK.
--  SECURITY DEFINER para bypass de RLS — autorizamos via role.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- excluir_venda(financeiro_id) -- apaga uma venda completa
--   Ordem: comissao_movimentos -> comissoes -> parcelas -> financeiro
--   Permitido a admin e financeiro.
-- ──────────────────────────────────────────────────────────────
create or replace function public.excluir_venda(p_fin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','financeiro') then
    return jsonb_build_object('ok', false, 'error', 'Apenas admin/financeiro podem excluir vendas.');
  end if;

  -- 1) movimentos das comissoes desta venda
  delete from public.comissao_movimentos
   where comissao_id in (select id from public.comissoes where financeiro_id = p_fin_id);

  -- 2) comissoes
  delete from public.comissoes where financeiro_id = p_fin_id;

  -- 3) parcelas (FK ON DELETE CASCADE provavelmente, mas garantimos)
  delete from public.parcelas where financeiro_id = p_fin_id;

  -- 4) financeiro
  delete from public.financeiro where id = p_fin_id;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.excluir_venda(uuid) to authenticated, service_role;

-- ──────────────────────────────────────────────────────────────
-- excluir_cliente(cliente_id) -- apaga cliente e tudo relacionado
--   Permitido a admin/comercial.
-- ──────────────────────────────────────────────────────────────
create or replace function public.excluir_cliente(p_cli_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  rec record;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','comercial') then
    return jsonb_build_object('ok', false, 'error', 'Apenas admin/comercial podem excluir clientes.');
  end if;

  -- Apaga vendas (e dependentes) deste cliente
  for rec in select id from public.financeiro where cliente_id = p_cli_id
  loop
    perform public.excluir_venda(rec.id);
  end loop;

  -- Outras dependencias (best-effort; se ja tem CASCADE, nao quebra)
  begin delete from public.contratos where cliente_id = p_cli_id; exception when others then null; end;
  begin delete from public.historico where cliente_id = p_cli_id; exception when others then null; end;
  begin update public.participantes set cliente_id = null where cliente_id = p_cli_id; exception when others then null; end;
  begin delete from public.notificacoes where cliente_id = p_cli_id; exception when others then null; end;

  -- Cliente
  delete from public.clientes where id = p_cli_id;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.excluir_cliente(uuid) to authenticated, service_role;

-- ──────────────────────────────────────────────────────────────
-- excluir_parcela(parcela_id) -- apaga uma parcela especifica
--   Estorna proporcionalmente comissoes liberadas (se parcela
--   estava 'Pago', desfaz a liberacao das comissoes da venda).
--   Permitido a admin/financeiro.
-- ──────────────────────────────────────────────────────────────
create or replace function public.excluir_parcela(p_parc_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_valor numeric;
  v_fin_id uuid;
  v_total numeric;
  v_fracao numeric;
  c record;
  v_estorno numeric;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin','financeiro') then
    return jsonb_build_object('ok', false, 'error', 'Apenas admin/financeiro podem excluir parcelas.');
  end if;

  select pa.status, pa.valor, pa.financeiro_id, fi.valor_total
    into v_status, v_valor, v_fin_id, v_total
  from public.parcelas pa
  join public.financeiro fi on fi.id = pa.financeiro_id
  where pa.id = p_parc_id;

  if v_fin_id is null then
    return jsonb_build_object('ok', false, 'error', 'Parcela nao encontrada.');
  end if;

  -- Se a parcela estava paga, estorna proporcional das comissoes
  if v_status = 'Pago' and v_total > 0 then
    v_fracao := v_valor / v_total;
    for c in
      select id, valor_total, valor_liberado from public.comissoes where financeiro_id = v_fin_id
    loop
      v_estorno := round((c.valor_total * v_fracao)::numeric, 2);
      if v_estorno > coalesce(c.valor_liberado, 0) then v_estorno := coalesce(c.valor_liberado, 0); end if;
      if v_estorno > 0 then
        insert into public.comissao_movimentos (comissao_id, tipo, valor, descricao)
          values (c.id, 'estorno', v_estorno, 'Estorno por exclusao de parcela ' || p_parc_id::text);
        update public.comissoes
           set valor_liberado = greatest(0, coalesce(valor_liberado,0) - v_estorno),
               updated_at = now()
         where id = c.id;
      end if;
    end loop;
  end if;

  delete from public.parcelas where id = p_parc_id;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.excluir_parcela(uuid) to authenticated, service_role;
