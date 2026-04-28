import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────
//  Lógica compartilhada de venda do programa Outliers.
//  Usado por CheckinPage (após QR) e EventosPage (botão direto).
// ─────────────────────────────────────────────────────────────

function isoData(d) { return d.toISOString().slice(0, 10) }

// Soma N meses a uma data, ajustando dia se mês destino tem menos dias.
function somarMeses(base, m) {
  var d = new Date(base.getTime())
  var diaAlvo = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + m)
  var ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(diaAlvo, ultimoDia))
  return d
}

// Distribui valores de parcelas com correção de centavos na última.
export function calcularParcelas(valorTotal, desconto, modalidade, numParcelas) {
  var n = modalidade === 'A Vista' ? 1 : Number(numParcelas)
  var liq = Number(valorTotal) - Number(desconto)
  var centavos = Math.round(liq * 100)
  var vlrUnit = Math.floor(centavos / n) / 100
  var vlrUltima = (centavos - Math.floor(centavos / n) * (n - 1)) / 100

  var hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  var vencimentos
  if (modalidade === 'A Vista') {
    var d = new Date(hoje); d.setDate(d.getDate() + 3)
    vencimentos = [isoData(d)]
  } else {
    vencimentos = []
    for (var i = 1; i <= n; i++) vencimentos.push(isoData(somarMeses(hoje, i)))
  }

  var parcelas = []
  for (var j = 0; j < n; j++) {
    parcelas.push({
      numero: j + 1,
      valor: j === n - 1 ? vlrUltima : vlrUnit,
      vencimento: vencimentos[j],
      status: 'Pendente',
    })
  }
  return { liquido: liq, n: n, parcelas: parcelas }
}

// Registra venda completa. Se participante existe sem cliente_id, cria o cliente.
// Atualiza programa, stage='Ganho', participante.comprou=true.
// Retorna { financeiro_id, cliente_id }.
export async function registrarVendaOutliers(opts) {
  var participante = opts.participante           // pode ser null se vier de outro fluxo
  var clienteIdInicial = opts.clienteId || (participante && participante.cliente_id) || null
  var eventoId = opts.eventoId || (participante && participante.evento_id) || null
  var venda = opts.venda                          // { modalidade, num_parcelas, valor_total, desconto, forma_pagamento }
  var userId = opts.userId || null

  // ── 1. Garante cliente ──
  var clienteId = clienteIdInicial
  if (!clienteId && participante) {
    var insertCli = {
      nome: participante.nome,
      email: participante.email || null,
      telefone: participante.telefone || null,
      cpf: participante.cpf || null,
      origem: 'Paradigma',
      status: 'Ativo',
      programa: 'Outliers',
      stage: 'Ganho',
      evento_origem_id: eventoId,
      criado_por: userId,
    }
    var { data: novoCli, error: errCli } = await supabase.from('clientes').insert(insertCli).select().single()
    if (errCli) throw new Error('Erro ao criar cliente: ' + errCli.message)
    clienteId = novoCli.id
  } else if (clienteId) {
    // Cliente já existia — atualiza programa/stage pra refletir compra
    await supabase.from('clientes').update({
      programa: 'Outliers',
      stage: 'Ganho',
      status: 'Ativo',
      ultimo_contato: new Date().toISOString(),
    }).eq('id', clienteId)
  }

  if (!clienteId) throw new Error('Não foi possível determinar o cliente da venda')

  // ── 2. Cria financeiro ──
  var { data: fin, error: errFin } = await supabase.from('financeiro').insert({
    cliente_id: clienteId,
    modalidade: venda.modalidade,
    valor_total: Number(venda.valor_total),
    desconto: Number(venda.desconto || 0),
    forma_pagamento: venda.forma_pagamento,
  }).select().single()
  if (errFin) throw new Error('Erro ao criar registro financeiro: ' + errFin.message)

  // ── 3. Cria parcelas com vencimento mensal ──
  var calc = calcularParcelas(venda.valor_total, venda.desconto || 0, venda.modalidade, venda.num_parcelas)
  var rows = calc.parcelas.map(function(p) {
    return { financeiro_id: fin.id, numero: p.numero, valor: p.valor, vencimento: p.vencimento, status: p.status }
  })
  var { error: errParc } = await supabase.from('parcelas').insert(rows)
  if (errParc) throw new Error('Erro ao criar parcelas: ' + errParc.message)

  // ── 4. Atualiza participante (se houver) ──
  if (participante && participante.id) {
    await supabase.from('participantes').update({ cliente_id: clienteId, comprou: true }).eq('id', participante.id)
  }

  return { financeiro_id: fin.id, cliente_id: clienteId, parcelas: calc.parcelas.length }
}
