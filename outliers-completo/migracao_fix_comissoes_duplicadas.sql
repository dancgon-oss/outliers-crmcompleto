-- ============================================================
--  FIX: 2 triggers duplicados liberando comissoes ao pagar parcela.
--  Mantemos o trigger original (fn_liberar_comissoes_da_parcela
--  com ON CONFLICT) e criamos novo trigger SO PRA notificacao.
-- ============================================================

-- 1) Remove o trigger e funcoes duplicadas que eu criei
drop trigger if exists tg_parcela_paga_trg on public.parcelas;
drop function if exists public.tg_parcela_paga() cascade;
drop function if exists public.liberar_comissoes_de_parcela(uuid) cascade;

-- 2) Limpa movimentos duplicados (os sem parcela_id eram criados pela funcao bugada)
delete from public.comissao_movimentos
where tipo = 'liberacao' and parcela_id is null
  and (descricao like 'Auto: parcela%' or descricao like 'Liberacao retroativa%' or descricao like 'Liberação retroativa%');

-- 3) Recalcula valor_liberado de cada comissao baseado nos movimentos restantes
update public.comissoes c set valor_liberado = (
  select coalesce(sum(case when m.tipo = 'liberacao' then m.valor when m.tipo = 'estorno' then -m.valor else 0 end), 0)
  from public.comissao_movimentos m
  where m.comissao_id = c.id
), updated_at = now();

-- 4) Cria novo trigger SO PRA notificacao (a liberacao ja e feita pelo trigger preexistente)
create or replace function public.tg_parcela_paga_notif()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_cliente_nome text;
  v_msg text;
begin
  if NEW.status = 'Pago' and (OLD.status is distinct from 'Pago') then
    select fi.cliente_id into v_cliente_id
      from public.financeiro fi where fi.id = NEW.financeiro_id;
    select nome into v_cliente_nome
      from public.clientes where id = v_cliente_id;

    v_msg := coalesce(v_cliente_nome,'Cliente') || ' pagou a parcela ' || coalesce(NEW.numero::text,'?')
             || ' (' || to_char(NEW.valor, 'FM999G999G990D00') || ').';

    insert into public.notificacoes (tipo, titulo, mensagem, parcela_id, cliente_id, para_role)
    values ('pagamento_recebido', 'Pagamento recebido', v_msg, NEW.id, v_cliente_id, 'admin');
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_parcela_paga_notif_trg on public.parcelas;
create trigger tg_parcela_paga_notif_trg
  after update of status on public.parcelas
  for each row execute function public.tg_parcela_paga_notif();
