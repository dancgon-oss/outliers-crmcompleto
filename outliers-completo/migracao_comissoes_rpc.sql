-- ============================================================
--  MIGRACAO MASTER: comissoes via RPC (programador senior mode)
--
--  - Remove FKs quebradas e NOT-NULL desnecessarios
--  - Cria funcao RPC `aplicar_regras_comissao(financeiro_id)` que
--    encapsula toda a logica de criacao de comissoes
--  - Cria funcao RPC `aplicar_regras_em_todas_vendas()` para
--    regularizar vendas legadas em massa
--
--  Idempotente. Pode rodar quantas vezes quiser.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1) Remove FKs quebradas / torna colunas nullable / defaults
-- ──────────────────────────────────────────────────────────────

alter table public.comissoes drop constraint if exists comissoes_venda_id_fkey;

do $$
declare col text;
begin
  for col in
    select unnest(array['venda_id','valor_base','valor_total','valor_pago','valor_liberado','status'])
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='comissoes' and column_name=col and is_nullable='NO'
    ) then
      execute format('alter table public.comissoes alter column %I drop not null', col);
    end if;
  end loop;
end $$;

-- Defaults sensatos
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='comissoes' and column_name='valor_pago') then
    execute 'alter table public.comissoes alter column valor_pago set default 0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='comissoes' and column_name='valor_liberado') then
    execute 'alter table public.comissoes alter column valor_liberado set default 0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='comissoes' and column_name='status') then
    execute 'alter table public.comissoes alter column status set default ''Aberta''';
  end if;
end $$;

-- Indice util para evitar duplicidades
create unique index if not exists comissoes_unique_venda_benef_papel
  on public.comissoes (financeiro_id, beneficiario_id, papel);

-- ──────────────────────────────────────────────────────────────
-- 2) FUNCAO RPC: aplicar_regras_comissao(p_fin_id)
--    Cria comissoes para 1 venda conforme regras ativas do curso.
--    Calcula liberacao retroativa de parcelas ja pagas.
--    Idempotente (skip se beneficiario+papel ja existe).
-- ──────────────────────────────────────────────────────────────
create or replace function public.aplicar_regras_comissao(p_fin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_curso_id     uuid;
  v_cliente_id   uuid;
  v_valor_total  numeric;
  v_desconto     numeric;
  v_liq          numeric;
  v_total_pago   numeric;
  v_created      int := 0;
  v_skipped      int := 0;
  v_no_rules     boolean := true;
  v_no_curso     boolean := false;
  r              record;
  v_vt           numeric;
  v_vl           numeric;
  v_new_id       uuid;
  v_nomes_criados text[] := array[]::text[];
begin
  select curso_id, cliente_id, valor_total, coalesce(desconto,0)
    into v_curso_id, v_cliente_id, v_valor_total, v_desconto
  from public.financeiro where id = p_fin_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Venda nao encontrada');
  end if;
  if v_curso_id is null then
    return jsonb_build_object('ok', false, 'error', 'Venda sem curso vinculado. Edite o financeiro e selecione o curso antes de aplicar regras.');
  end if;

  v_liq := coalesce(v_valor_total, 0) - v_desconto;

  select coalesce(sum(valor), 0) into v_total_pago
  from public.parcelas where financeiro_id = p_fin_id and status = 'Pago';

  for r in
    select cr.profile_id, cr.papel, cr.percentual, p.nome as benef_nome
    from public.comissao_regras cr
    left join public.profiles p on p.id = cr.profile_id
    where cr.curso_id = v_curso_id and cr.ativa = true
  loop
    v_no_rules := false;

    if exists (
      select 1 from public.comissoes
      where financeiro_id = p_fin_id
        and beneficiario_id = r.profile_id
        and papel = r.papel
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_vt := round((v_liq * r.percentual / 100)::numeric, 2);
    v_vl := round((v_total_pago * r.percentual / 100)::numeric, 2);

    insert into public.comissoes (
      financeiro_id, cliente_id, curso_id, beneficiario_id, papel, percentual,
      valor_base, valor_total, valor_liberado, valor_pago, status
    ) values (
      p_fin_id, v_cliente_id, v_curso_id, r.profile_id, r.papel, r.percentual,
      v_liq, v_vt, v_vl, 0, 'Aberta'
    ) returning id into v_new_id;

    if v_vl > 0 then
      insert into public.comissao_movimentos (comissao_id, tipo, valor, descricao)
      values (v_new_id, 'liberacao', v_vl, 'Liberacao retroativa de parcelas ja pagas');
    end if;

    v_created := v_created + 1;
    v_nomes_criados := v_nomes_criados || (coalesce(r.benef_nome,'?') || ' (' || r.papel || ' ' || r.percentual || '%)');
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'skipped', v_skipped,
    'no_rules', v_no_rules,
    'no_curso', v_no_curso,
    'criados_nomes', v_nomes_criados
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.aplicar_regras_comissao(uuid) to authenticated, service_role;

-- ──────────────────────────────────────────────────────────────
-- 3) FUNCAO RPC: aplicar_regras_em_todas_vendas()
--    Roda aplicar_regras_comissao em todas as vendas existentes.
--    Util para regularizar o legado de uma vez so.
-- ──────────────────────────────────────────────────────────────
create or replace function public.aplicar_regras_em_todas_vendas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_vendas int := 0;
  v_total_criadas int := 0;
  v_total_pulou   int := 0;
  v_sem_curso     int := 0;
  rec             record;
  res             jsonb;
begin
  for rec in select id from public.financeiro
  loop
    v_total_vendas := v_total_vendas + 1;
    res := public.aplicar_regras_comissao(rec.id);
    if (res->>'ok')::boolean then
      v_total_criadas := v_total_criadas + coalesce((res->>'created')::int, 0);
      v_total_pulou   := v_total_pulou   + coalesce((res->>'skipped')::int, 0);
    else
      if (res->>'error') ilike '%sem curso%' then
        v_sem_curso := v_sem_curso + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'vendas_processadas', v_total_vendas,
    'comissoes_criadas',  v_total_criadas,
    'comissoes_existentes', v_total_pulou,
    'vendas_sem_curso', v_sem_curso
  );
end;
$$;

grant execute on function public.aplicar_regras_em_todas_vendas() to authenticated, service_role;

-- ──────────────────────────────────────────────────────────────
-- VERIFICACAO
-- select column_name, is_nullable, column_default from information_schema.columns
--  where table_schema='public' and table_name='comissoes' order by ordinal_position;
-- select * from public.aplicar_regras_em_todas_vendas();
-- ──────────────────────────────────────────────────────────────
