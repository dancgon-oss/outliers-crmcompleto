-- ============================================================
--  STATUS DO CLIENTE: recalculo automatico
--
--  Regra:
--    - Se cliente tem alguma parcela com status='Atrasado'  → Inadimplente
--    - Caso contrario, se status atual era 'Inadimplente'   → Ativo
--    - Outros status (cancelado, ex-aluno, etc.) sao preservados
--
--  Fontes:
--    1) Trigger AFTER UPDATE em parcelas (recalcula automatico
--       sempre que alguem muda status de parcela manualmente)
--    2) RPC `recalcular_status_todos_clientes()` para corrigir
--       o estado atual de todos os clientes
--
--  Idempotente.
-- ============================================================

create or replace function public.recalcular_status_cliente(p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tem_atrasada boolean;
  v_status_atual text;
begin
  if p_cliente_id is null then return; end if;

  select status into v_status_atual from public.clientes where id = p_cliente_id;
  if not found then return; end if;

  select exists(
    select 1
    from public.parcelas pa
    join public.financeiro fi on fi.id = pa.financeiro_id
    where fi.cliente_id = p_cliente_id and pa.status = 'Atrasado'
  ) into v_tem_atrasada;

  if v_tem_atrasada and v_status_atual is distinct from 'Inadimplente' then
    update public.clientes set status = 'Inadimplente' where id = p_cliente_id;
  elsif (not v_tem_atrasada) and v_status_atual = 'Inadimplente' then
    update public.clientes set status = 'Ativo' where id = p_cliente_id;
  end if;
end;
$$;

grant execute on function public.recalcular_status_cliente(uuid) to authenticated, service_role;

-- ──────────────────────────────────────────────────────────────
-- Trigger: ao alterar parcelas, recalcula status do cliente.
-- Reaproveita o trigger AFTER UPDATE existente para parcelas.
-- ──────────────────────────────────────────────────────────────
create or replace function public.tg_parcela_recalc_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  -- so reage se status realmente mudou
  if (TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status) then
    return NEW;
  end if;

  select cliente_id into v_cliente_id from public.financeiro where id = NEW.financeiro_id;
  if v_cliente_id is not null then
    perform public.recalcular_status_cliente(v_cliente_id);
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_parcela_recalc_cliente_trg on public.parcelas;
create trigger tg_parcela_recalc_cliente_trg
  after insert or update of status on public.parcelas
  for each row execute function public.tg_parcela_recalc_cliente();

-- ──────────────────────────────────────────────────────────────
-- RPC: recalcula TODOS os clientes (regulariza legado de uma vez)
-- ──────────────────────────────────────────────────────────────
create or replace function public.recalcular_status_todos_clientes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_inadimplente_para_ativo int := 0;
  v_ativo_para_inadimplente int := 0;
  rec record;
  v_tem_atrasada boolean;
begin
  for rec in select id, status from public.clientes
  loop
    v_total := v_total + 1;
    select exists(
      select 1
      from public.parcelas pa
      join public.financeiro fi on fi.id = pa.financeiro_id
      where fi.cliente_id = rec.id and pa.status = 'Atrasado'
    ) into v_tem_atrasada;

    if v_tem_atrasada and rec.status is distinct from 'Inadimplente' then
      update public.clientes set status = 'Inadimplente' where id = rec.id;
      v_ativo_para_inadimplente := v_ativo_para_inadimplente + 1;
    elsif (not v_tem_atrasada) and rec.status = 'Inadimplente' then
      update public.clientes set status = 'Ativo' where id = rec.id;
      v_inadimplente_para_ativo := v_inadimplente_para_ativo + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'clientes_processados', v_total,
    'inadimplente_para_ativo', v_inadimplente_para_ativo,
    'ativo_para_inadimplente', v_ativo_para_inadimplente
  );
end;
$$;

grant execute on function public.recalcular_status_todos_clientes() to authenticated, service_role;
