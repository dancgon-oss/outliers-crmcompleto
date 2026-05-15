// Importador de planilha de clientes Outliers (CSV).
//
// Formato (cabecalho na 1a linha, separador ';' ou ','):
//   nome; email; telefone; cpf; curso;
//   valor_total; desconto;
//   entrada_valor; entrada_forma; entrada_data; entrada_paga;
//   bloco1_valor; bloco1_parcelas; bloco1_forma; bloco1_primeira_data;
//   bloco2_valor; bloco2_parcelas; bloco2_forma; bloco2_primeira_data;
//   parcelas_pagas; datas_pagamento;
//   programa; edicao; origem; observacoes
//
// Como funciona:
// - Entrada: cria parcela #1 com vencimento = entrada_data,
//   forma_pagamento = entrada_forma. Se entrada_paga=Sim, marca como Pago.
// - Bloco1: gera N parcelas mensais a partir de bloco1_primeira_data,
//   valor unitario = bloco1_valor / bloco1_parcelas, forma = bloco1_forma.
//   Numeradas a partir de #2 (ou #1 se nao houver entrada).
// - Bloco2: opcional, mesma logica que bloco1, numeracao continua.
// - parcelas_pagas: lista de numeros (geral) ja pagos. As datas em
//   datas_pagamento aplicam-se a esses numeros (mesma ordem).
//   A entrada_paga=Sim faz a parcela #1 ja vir como paga.
//
// Validacao: a soma (entrada + bloco1 + bloco2) deve bater com
//   valor_total - desconto. Pequeno arredondamento e tolerado.
import { supabase } from './supabase'

function parseSep(line) { return (line.indexOf(';') >= 0) ? ';' : ',' }

function unquote(s) {
  if (!s) return s
  s = s.trim()
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length-1) === '"') s = s.slice(1, -1)
  return s
}

function parseCSV(text) {
  var lines = text.replace(/\r/g, '').split('\n').filter(function(l){ return l.trim().length > 0 })
  if (!lines.length) return { headers: [], rows: [] }
  var sep = parseSep(lines[0])
  function splitRow(line) {
    var out = []; var cur = ''; var inQ = false
    for (var i = 0; i < line.length; i++) {
      var ch = line[i]
      if (ch === '"') { inQ = !inQ; continue }
      if (ch === sep && !inQ) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur)
    return out.map(function(c){ return c.trim() })
  }
  var headers = splitRow(lines[0]).map(function(h){ return h.toLowerCase().replace(/\s+/g,'_') })
  var rows = []
  for (var i = 1; i < lines.length; i++) {
    var cols = splitRow(lines[i])
    var obj = {}
    headers.forEach(function(h, idx){ obj[h] = unquote(cols[idx] || '') })
    rows.push(obj)
  }
  return { headers: headers, rows: rows }
}

function parseNumber(s) {
  if (s == null) return 0
  var t = String(s).trim().replace(/\s/g,'')
  if (!t) return 0
  if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) t = t.replace(/\./g, '').replace(',', '.')
  else if (t.indexOf(',') >= 0) t = t.replace(',', '.')
  var n = Number(t)
  return isNaN(n) ? 0 : n
}

function isoDate(s) {
  if (!s) return null
  var t = String(s).trim()
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return t
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return m[3] + '-' + m[2] + '-' + m[1]
  return null
}

function somarMeses(baseISO, n) {
  var d = new Date(baseISO + 'T00:00:00')
  var diaAlvo = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + n)
  var ultimo = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
  d.setDate(Math.min(diaAlvo, ultimo))
  return d.toISOString().slice(0,10)
}

function dividirCentavos(total, n) {
  // Distribui em N parcelas, ajusta centavos na ultima
  var centavos = Math.round(total * 100)
  var unit = Math.floor(centavos / n) / 100
  var ultima = (centavos - Math.floor(centavos / n) * (n - 1)) / 100
  var out = []
  for (var i = 0; i < n; i++) out.push(i === n-1 ? ultima : unit)
  return out
}

function listaInts(s) {
  if (!s) return []
  return String(s).split(',').map(function(x){ return parseInt(x.trim(), 10) }).filter(function(n){ return !isNaN(n) && n > 0 })
}

function listaDatas(s) {
  if (!s) return []
  return String(s).split(',').map(function(x){ return isoDate(x.trim()) })
}

function ehPaga(s) {
  if (!s) return false
  var t = String(s).trim().toLowerCase()
  return t === 'sim' || t === 's' || t === 'yes' || t === 'y' || t === '1' || t === 'true' || t === 'pago' || t === 'paga'
}

export async function importarPlanilhaOutliers(text, opts) {
  opts = opts || {}
  var userId = opts.userId || null
  var parsed = parseCSV(text)
  if (!parsed.rows.length) return { ok: false, error: 'Planilha vazia.', criados: 0, erros: [] }

  var must = ['nome','valor_total']
  for (var k = 0; k < must.length; k++) {
    if (parsed.headers.indexOf(must[k]) === -1) {
      return { ok: false, error: 'Coluna obrigatória ausente: ' + must[k] + '. Cabeçalho recebido: ' + parsed.headers.join(', '), criados: 0, erros: [] }
    }
  }

  var rc = await supabase.from('cursos').select('id,nome,categoria,ativo')
  var cursos = rc.data || []
  function findCurso(nome) {
    if (!nome) return null
    var n = nome.toLowerCase()
    var hit = cursos.find(function(c){ return (c.nome||'').toLowerCase() === n })
    if (hit) return hit
    hit = cursos.find(function(c){ return (c.nome||'').toLowerCase().indexOf(n) >= 0 })
    return hit || null
  }

  var criados = 0
  var erros = []
  var detalhes = []

  for (var i = 0; i < parsed.rows.length; i++) {
    var linha = parsed.rows[i]
    var nro = i + 2
    try {
      var nome = (linha.nome || '').trim()
      if (!nome) { erros.push({ linha: nro, motivo: 'nome vazio' }); continue }

      var valor_total = parseNumber(linha.valor_total)
      var desconto = parseNumber(linha.desconto || '0')
      var liq = valor_total - desconto
      if (valor_total <= 0) { erros.push({ linha: nro, motivo: 'valor_total inválido' }); continue }

      // ── ENTRADA ──
      var entrada_valor = parseNumber(linha.entrada_valor || '0')
      var entrada_forma = (linha.entrada_forma || '').trim() || null
      var entrada_data = isoDate(linha.entrada_data)
      var entrada_paga = ehPaga(linha.entrada_paga)

      // ── BLOCO 1 ──
      var b1_valor = parseNumber(linha.bloco1_valor || '0')
      var b1_n = parseInt(linha.bloco1_parcelas || '0', 10) || 0
      var b1_forma = (linha.bloco1_forma || '').trim() || null
      var b1_data = isoDate(linha.bloco1_primeira_data)

      // ── BLOCO 2 ──
      var b2_valor = parseNumber(linha.bloco2_valor || '0')
      var b2_n = parseInt(linha.bloco2_parcelas || '0', 10) || 0
      var b2_forma = (linha.bloco2_forma || '').trim() || null
      var b2_data = isoDate(linha.bloco2_primeira_data)

      // FALLBACK: se nada de bloco preenchido, aceita formato antigo (num_parcelas + data_primeira_parcela)
      if (entrada_valor === 0 && b1_valor === 0 && b2_valor === 0) {
        var n = parseInt(linha.num_parcelas || '1', 10) || 1
        var d = isoDate(linha.data_primeira_parcela)
        if (!d) { erros.push({ linha: nro, motivo: 'sem entrada nem blocos nem num_parcelas/data_primeira_parcela' }); continue }
        b1_valor = liq
        b1_n = n
        b1_forma = (linha.modalidade || '').toLowerCase().indexOf('vista') >= 0 ? 'PIX' : null
        b1_data = d
      }

      // Valida soma
      var somaBlocos = entrada_valor + b1_valor + b2_valor
      if (Math.abs(somaBlocos - liq) > 0.05) {
        erros.push({ linha: nro, motivo: 'soma de entrada+bloco1+bloco2 (' + somaBlocos.toFixed(2) + ') não bate com valor_total-desconto (' + liq.toFixed(2) + ')' })
        continue
      }

      // ── 1. Cria/atualiza cliente ──
      var lookup = null
      if (linha.email) {
        var r1 = await supabase.from('clientes').select('id').eq('email', linha.email).maybeSingle()
        if (r1.data) lookup = r1.data
      }
      if (!lookup && linha.cpf) {
        var r2 = await supabase.from('clientes').select('id').eq('cpf', linha.cpf).maybeSingle()
        if (r2.data) lookup = r2.data
      }
      var cursoNome = (linha.curso || '').trim()
      var curso = findCurso(cursoNome)
      var clientePayload = {
        nome: nome,
        email: linha.email || null,
        telefone: linha.telefone || null,
        cpf: linha.cpf || null,
        origem: linha.origem || 'Importacao',
        status: 'Ativo',
        programa: linha.programa || (cursoNome || 'Outliers'),
        edicao: linha.edicao || null,
        observacoes: linha.observacoes || null,
        stage: 'Ganho',
        criado_por: userId,
      }
      var cliente_id
      if (lookup) {
        await supabase.from('clientes').update(clientePayload).eq('id', lookup.id)
        cliente_id = lookup.id
      } else {
        var ci = await supabase.from('clientes').insert(clientePayload).select().single()
        if (ci.error) { erros.push({ linha: nro, motivo: 'cliente: ' + ci.error.message }); continue }
        cliente_id = ci.data.id
      }

      // ── 2. Cria financeiro ──
      var totalParcelas = (entrada_valor > 0 ? 1 : 0) + b1_n + b2_n
      var modalidade = totalParcelas <= 1 ? 'A Vista' : 'Parcelado'
      // Forma principal: a do bloco com mais peso
      var formaPrincipal = b1_forma || entrada_forma || b2_forma || null
      var finPayload = {
        cliente_id: cliente_id,
        modalidade: modalidade,
        valor_total: valor_total,
        desconto: desconto,
        forma_pagamento: formaPrincipal,
      }
      if (curso) finPayload.curso_id = curso.id
      var fi = await supabase.from('financeiro').insert(finPayload).select().single()
      if (fi.error) { erros.push({ linha: nro, motivo: 'financeiro: ' + fi.error.message }); continue }
      var fin_id = fi.data.id

      // ── 3. Monta lista de parcelas (entrada + bloco1 + bloco2) ──
      var todasParcelas = []
      var numero = 0
      if (entrada_valor > 0) {
        numero++
        todasParcelas.push({
          financeiro_id: fin_id,
          numero: numero,
          valor: entrada_valor,
          vencimento: entrada_data || (b1_data || new Date().toISOString().slice(0,10)),
          status: entrada_paga ? 'Pago' : 'Pendente',
          pago_em: entrada_paga ? (entrada_data || new Date().toISOString().slice(0,10)) : null,
          forma_pagamento: entrada_forma,
        })
      }
      if (b1_n > 0 && b1_data) {
        var vals1 = dividirCentavos(b1_valor, b1_n)
        for (var j1 = 0; j1 < b1_n; j1++) {
          numero++
          todasParcelas.push({
            financeiro_id: fin_id,
            numero: numero,
            valor: vals1[j1],
            vencimento: somarMeses(b1_data, j1),
            status: 'Pendente',
            pago_em: null,
            forma_pagamento: b1_forma,
          })
        }
      }
      if (b2_n > 0 && b2_data) {
        var vals2 = dividirCentavos(b2_valor, b2_n)
        for (var j2 = 0; j2 < b2_n; j2++) {
          numero++
          todasParcelas.push({
            financeiro_id: fin_id,
            numero: numero,
            valor: vals2[j2],
            vencimento: somarMeses(b2_data, j2),
            status: 'Pendente',
            pago_em: null,
            forma_pagamento: b2_forma,
          })
        }
      }

      // ── 4. Aplica parcelas_pagas / datas_pagamento ──
      var pagasNumeros = listaInts(linha.parcelas_pagas)
      var pagasDatas = listaDatas(linha.datas_pagamento)
      pagasNumeros.forEach(function(num, idx) {
        var p = todasParcelas.find(function(x){ return x.numero === num })
        if (p) {
          p.status = 'Pago'
          p.pago_em = pagasDatas[idx] || p.vencimento
        }
      })

      var pi = await supabase.from('parcelas').insert(todasParcelas)
      if (pi.error) { erros.push({ linha: nro, motivo: 'parcelas: ' + pi.error.message }); continue }

      // ── 5. Aplica regras de comissao ──
      try { await supabase.rpc('aplicar_regras_comissao', { p_fin_id: fin_id }) } catch (_e) {}

      detalhes.push({ linha: nro, nome: nome, parcelas: todasParcelas.length })
      criados++
    } catch (e) {
      erros.push({ linha: nro, motivo: (e && e.message) || String(e) })
    }
  }

  return { ok: true, criados: criados, erros: erros, detalhes: detalhes }
}
