-- Refaz vw_comissoes_parcelas: para parcelas PAGAS distribui o valor_liberado
-- real da comissao proporcionalmente entre elas (total sempre bate com tabela
-- comissoes). Para pendentes/atrasadas usa proporcao dinamica do valor total.
create or replace view public.vw_comissoes_parcelas as
with pi as (
  select
    pa.id, pa.numero, pa.valor, pa.vencimento, pa.status, pa.pago_em, pa.financeiro_id,
    sum(case when pa.status = 'Pago' then pa.valor else 0 end)
      over (partition by pa.financeiro_id) as total_pago_venda,
    sum(case when pa.status <> 'Pago' then pa.valor else 0 end)
      over (partition by pa.financeiro_id) as total_pendente_venda,
    sum(pa.valor) over (partition by pa.financeiro_id) as total_parcelas_venda
  from public.parcelas pa
)
select
  c.id                     as comissao_id,
  c.beneficiario_id,
  pr.nome                  as beneficiario_nome,
  c.papel,
  c.percentual,
  c.cliente_id,
  cli.nome                 as cliente_nome,
  c.curso_id,
  cur.nome                 as curso_nome,
  c.valor_total            as comissao_total,
  c.financeiro_id,
  pi.id                    as parcela_id,
  pi.numero                as parcela_numero,
  pi.valor                 as parcela_valor_cliente,
  pi.vencimento            as parcela_vencimento,
  pi.status                as parcela_status,
  pi.pago_em               as parcela_pago_em,
  case
    when pi.status = 'Pago' and pi.total_pago_venda > 0 then
      round((coalesce(c.valor_liberado, 0) * pi.valor / pi.total_pago_venda)::numeric, 2)
    when pi.status <> 'Pago' and pi.total_pendente_venda > 0 then
      round(((coalesce(c.valor_total, 0) - coalesce(c.valor_liberado, 0)) * pi.valor / pi.total_pendente_venda)::numeric, 2)
    else 0
  end                      as comissao_parcela_valor,
  case
    when pi.status = 'Pago'     then 'Liberada'
    when pi.status = 'Atrasado' then 'Atrasada'
    else 'Prevista'
  end                      as comissao_parcela_status
from public.comissoes c
join pi on pi.financeiro_id = c.financeiro_id
left join public.profiles pr  on pr.id = c.beneficiario_id
left join public.clientes cli on cli.id = c.cliente_id
left join public.cursos cur   on cur.id = c.curso_id
where c.status is null or c.status <> 'Cancelada';
