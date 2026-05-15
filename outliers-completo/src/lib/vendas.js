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
    // Convenção: 1ª parcela é entrada (vence hoje), 2ª em +1 mês, ..., Nª em +(N-1) meses
    vencimentos = []
    for (var i = 0; i < n; i++) vencimentos.push(isoData(somarMeses(hoje, i)))
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

// Registra venda completa de um curso/produto. Se participante existe sem
// cliente_id, cria o cliente. Marca participante.comprou=true.
// Atualiza programa do cliente APENAS se opts.atualizarPrograma for passado.
// Atualiza stage='Ganho' por padrão (cliente saiu do funil).
// Retorna { financeiro_id, cliente_id, parcelas }.
export async function registrarVenda(opts) {
  var participante = opts.participante           // pode ser null se vier de outro fluxo
  var clienteIdInicial = opts.clienteId || (participante && participante.cliente_id) || null
  var eventoId = opts.eventoId || (participante && participante.evento_id) || null
  var venda = opts.venda                          // { modalidade, num_parcelas, valor_total, desconto, forma_pagamento }
  var cursoId = opts.cursoId || null              // qual produto foi vendido (FK pra cursos)
  var atualizarPrograma = opts.atualizarPrograma  // ex: 'Outliers' — só passa quando faz sentido renomear o programa principal do cliente
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
      programa: atualizarPrograma || 'Outliers',
      stage: 'Ganho',
      evento_origem_id: eventoId,
      criado_por: userId,
    }
    var { data: novoCli, error: errCli } = await supabase.from('clientes').insert(insertCli).select().single()
    if (errCli) throw new Error('Erro ao criar cliente: ' + errCli.message)
    clienteId = novoCli.id
  } else if (clienteId) {
    var updCli = {
      stage: 'Ganho',
      status: 'Ativo',
      ultimo_contato: new Date().toISOString(),
    }
    if (atualizarPrograma) updCli.programa = atualizarPrograma
    await supabase.from('clientes').update(updCli).eq('id', clienteId)
  }

  if (!clienteId) throw new Error('Não foi possível determinar o cliente da venda')

  // ── 2. Cria financeiro ──
  var insertFin = {
    cliente_id: clienteId,
    modalidade: venda.modalidade,
    valor_total: Number(venda.valor_total),
    desconto: Number(venda.desconto || 0),
    forma_pagamento: venda.forma_pagamento,
  }
  if (cursoId) insertFin.curso_id = cursoId
  var { data: fin, error: errFin } = await supabase.from('financeiro').insert(insertFin).select().single()
  if (errFin) throw new Error('Erro ao criar registro financeiro: ' + errFin.message)

  // ── 3. Cria parcelas (com suporte a entrada separada) ──
  // Se venda.entrada_valor > 0, cria parcela #1 = entrada (com forma e status próprios)
  // e o restante (líquido - entrada) distribuído em N parcelas (forma da venda).
  var liq = Number(venda.valor_total) - Number(venda.desconto || 0)
  var entradaValor = Number(venda.entrada_valor || 0)
  var entradaForma = venda.entrada_forma || null
  var entradaPaga = !!venda.entrada_paga
  var formaParcelas = venda.forma_pagamento_parcelas || venda.forma_pagamento || null

  var rows = []
  var hoje = new Date(); hoje.setHours(0,0,0,0)
  var isoData = function(d){ return d.toISOString().slice(0,10) }
  var somarMeses = function(base, m) {
    var d = new Date(base.getTime())
    var diaAlvo = d.getDate()
    d.setDate(1); d.setMonth(d.getMonth() + m)
    var ult = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
    d.setDate(Math.min(diaAlvo, ult))
    return d
  }

  if (entradaValor > 0) {
    rows.push({
      financeiro_id: fin.id,
      numero: 1,
      valor: Number(entradaValor.toFixed(2)),
      vencimento: isoData(hoje),
      status: entradaPaga ? 'Pago' : 'Pendente',
      pago_em: entradaPaga ? isoData(hoje) : null,
      forma_pagamento: entradaForma,
    })
    var restante = liq - entradaValor
    var nParc = (venda.modalidade === 'A Vista') ? 0 : Number(venda.num_parcelas || 0)
    if (nParc > 0 && restante > 0.005) {
      var centavos = Math.round(restante * 100)
      var unit = Math.floor(centavos / nParc) / 100
      var ultima = (centavos - Math.floor(centavos / nParc) * (nParc - 1)) / 100
      for (var i = 0; i < nParc; i++) {
        rows.push({
          financeiro_id: fin.id,
          numero: i + 2,
          valor: i === nParc - 1 ? ultima : unit,
          vencimento: isoData(somarMeses(hoje, i + 1)),
          status: 'Pendente',
          pago_em: null,
          forma_pagamento: formaParcelas,
        })
      }
    }
  } else {
    // Sem entrada explicita → comportamento antigo
    var calc = calcularParcelas(venda.valor_total, venda.desconto || 0, venda.modalidade, venda.num_parcelas)
    rows = calc.parcelas.map(function(p) {
      return {
        financeiro_id: fin.id, numero: p.numero, valor: p.valor,
        vencimento: p.vencimento, status: p.status,
        forma_pagamento: formaParcelas,
      }
    })
  }
  var { error: errParc } = await supabase.from('parcelas').insert(rows)
  if (errParc) throw new Error('Erro ao criar parcelas: ' + errParc.message)

  // ── 4. Atualiza participante (se houver) ──
  if (participante && participante.id) {
    await supabase.from('participantes').update({ cliente_id: clienteId, comprou: true }).eq('id', participante.id)
  }

  // ── 5. Gera comissões automaticamente conforme regras ativas do curso ──
  // Usa RPC do banco (encapsula toda a lógica e schema da tabela comissoes)
  try {
    await supabase.rpc('aplicar_regras_comissao', { p_fin_id: fin.id })
  } catch (e) { /* nao bloqueia a venda */ }

  return { financeiro_id: fin.id, cliente_id: clienteId, parcelas: rows.length }
}

// Backward compat: chamadas antigas continuam funcionando
export var registrarVendaOutliers = registrarVenda
