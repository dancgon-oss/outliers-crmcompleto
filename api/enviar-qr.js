// Outliers · Envio automatizado de QR Code via WhatsApp (Bravos)
// Vercel API Route: POST /api/enviar-qr
//
// Body: { participante_id: string } OU { participante_ids: string[] }
// Headers: Authorization: Bearer <supabase_access_token>
//
// ⚠ Bravos é síncrono e tem delay anti-ban (7-15s por msg). Pra enviar em volume:
//   - o frontend chama 1x por participante em sequência (ver EventosPage)
//   - esta função processa 1-3 por chamada pra caber no timeout Vercel
//
// Mensagem: texto com URL de QR embutida (WhatsApp auto-renderiza preview da imagem).

export const config = { maxDuration: 60 } // requer Vercel Pro; Hobby ignora (10s)

const MAX_POR_REQ = 3 // limite por chamada pra não estourar timeout

function fmtDataBR(s) {
  if (!s) return ''
  var p = String(s).split('T')[0].split('-')
  return p.length >= 3 ? p[2] + '/' + p[1] + '/' + p[0] : s
}

function sanitizeTel(t) {
  if (!t) return null
  var only = String(t).replace(/\D/g, '')
  if (only.length === 11 || only.length === 10) return '55' + only
  if (only.length === 12 || only.length === 13) {
    return only.startsWith('55') ? only : only
  }
  return only || null
}

async function supaRest(path, opts) {
  opts = opts || {}
  var url = process.env.SUPABASE_URL + '/rest/v1/' + path
  var headers = {
    'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  }
  if (opts.prefer) headers['Prefer'] = opts.prefer
  var res = await fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  var txt = await res.text()
  var data = txt ? (function(){ try { return JSON.parse(txt) } catch(e) { return txt } })() : null
  return { ok: res.ok, status: res.status, data: data }
}

async function validateUser(authHeader) {
  var token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null
  var res = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'Authorization': 'Bearer ' + token,
      'apikey': process.env.SUPABASE_SERVICE_KEY,
    },
  })
  if (!res.ok) return null
  var user = await res.json()
  if (!user || !user.id) return null
  var prof = await supaRest('profiles?id=eq.' + user.id + '&select=role,nome')
  if (!prof.ok || !prof.data || !prof.data[0]) return null
  return { id: user.id, role: prof.data[0].role, nome: prof.data[0].nome }
}

async function logEnvio(participanteId, userId, status, providerId, erro, payload) {
  return supaRest('envios_qr', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      participante_id: participanteId,
      canal: 'whatsapp',
      status: status,
      provider_id: providerId || null,
      erro: erro || null,
      payload: payload || null,
      enviado_por: userId || null,
    },
  })
}

// ─── Provedor: Bravos ─────────────────────────────────────────────
// /send-message com linkPreview=true. A URL do QR vai no corpo da mensagem
// e o WhatsApp gera preview automático da imagem (api.qrserver.com entrega PNG).
//
// Bravos é síncrono e tem anti-ban de 7-15s. No Vercel Hobby (10s timeout)
// muitas chamadas vão estourar. Usamos timeout explícito: se não responder
// em BRAVOS_WAIT_MS, consideramos "pendente" (o Bravos provavelmente
// processou mesmo assim, mas não temos confirmação).
async function enviarBravos(telefone, mensagem) {
  var base = (process.env.BRAVOS_API_URL || '').replace(/\/$/, '')
  var token = process.env.BRAVOS_API_TOKEN
  if (!base || !token) throw new Error('BRAVOS_API_URL e BRAVOS_API_TOKEN obrigatórios')

  // Default conservador: 9s (dá margem dentro do limite Hobby de 10s)
  var waitMs = parseInt(process.env.BRAVOS_WAIT_MS || '9000', 10)
  var ctrl = new AbortController()
  var timer = setTimeout(function(){ ctrl.abort() }, waitMs)

  try {
    var res = await fetch(base + '/send-message', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chatId: telefone, message: mensagem, linkPreview: true }),
    })
    clearTimeout(timer)
    var data = null
    try { data = await res.json() } catch (e) { data = { rawStatus: res.status } }
    var ok = res.ok && data && data.ok === true
    return {
      status: ok ? 'enviado' : 'erro',
      provider_id: data && data.messageId ? data.messageId : null,
      erro: ok ? null : ((data && (data.error || data.message)) || ('HTTP ' + res.status)),
      payload: data,
    }
  } catch (e) {
    clearTimeout(timer)
    // AbortError = timeout nosso (Bravos provavelmente ainda vai processar)
    if (e && e.name === 'AbortError') {
      return {
        status: 'pendente',
        provider_id: null,
        erro: 'timeout ' + waitMs + 'ms aguardando Bravos (mensagem provavelmente foi enviada)',
        payload: null,
      }
    }
    return { status: 'erro', provider_id: null, erro: e.message || 'erro de rede', payload: null }
  }
}

function montarMensagem(participante, evento, checkinUrl, qrImageUrl) {
  var linhaEvento = evento && evento.nome ? '*' + evento.nome + '*' : 'seu evento'
  var linhaData = evento && evento.data_inicio
    ? '\n📅 ' + fmtDataBR(evento.data_inicio)
      + (evento.data_fim && evento.data_fim !== evento.data_inicio ? ' → ' + fmtDataBR(evento.data_fim) : '')
    : ''
  var linhaLocal = evento && evento.local ? '\n📍 ' + evento.local : ''
  return 'Olá, ' + (participante.nome || '') + '!\n\n'
    + 'Sua inscrição em ' + linhaEvento + ' está confirmada.'
    + linhaData + linhaLocal + '\n\n'
    + '🎫 *Seu QR Code de check-in:*\n'
    + qrImageUrl + '\n\n'
    + 'Apresente esta imagem na entrada do evento. Caso prefira, use o link direto:\n'
    + checkinUrl + '\n\n'
    + '— Equipe Outliers'
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    return res.status(200).end()
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  try {
    var user = await validateUser(req.headers.authorization)
    if (!user) return res.status(401).json({ error: 'unauthorized' })
    var ALLOWED = ['admin', 'comercial', 'financeiro', 'operacional']
    if (ALLOWED.indexOf(user.role) < 0) return res.status(403).json({ error: 'forbidden', role: user.role })

    var body = req.body || {}
    var ids = Array.isArray(body.participante_ids) ? body.participante_ids : []
    if (!ids.length && body.participante_id) ids = [body.participante_id]
    if (!ids.length) return res.status(400).json({ error: 'participante_id(s) obrigatório' })
    if (ids.length > MAX_POR_REQ) {
      return res.status(400).json({ error: 'máximo ' + MAX_POR_REQ + ' por chamada (Bravos é síncrono)' })
    }

    // Busca participantes + evento
    var idsQ = ids.map(function(i){ return '"' + i + '"' }).join(',')
    var select = 'id,nome,telefone,qr_token,evento_id,eventos(nome,data_inicio,data_fim,local)'
    var part = await supaRest('participantes?id=in.(' + idsQ + ')&select=' + encodeURIComponent(select))
    if (!part.ok) return res.status(500).json({ error: 'erro ao buscar participantes', detail: part.data })
    var lista = part.data || []
    if (!lista.length) return res.status(404).json({ error: 'nenhum participante encontrado' })

    var publicBase = (process.env.PUBLIC_APP_URL
      || ('https://' + (req.headers['x-forwarded-host'] || req.headers.host))
    ).replace(/\/$/, '')

    var results = []
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i]
      try {
        var tel = sanitizeTel(p.telefone)
        if (!tel) {
          await logEnvio(p.id, user.id, 'erro', null, 'sem telefone', null)
          results.push({ id: p.id, nome: p.nome, ok: false, erro: 'sem telefone' })
          continue
        }

        var checkinUrl = publicBase + '/checkin/' + p.qr_token
        var qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=' + encodeURIComponent(checkinUrl)
        var msg = montarMensagem(p, p.eventos || {}, checkinUrl, qrImageUrl)

        var envio = await enviarBravos(tel, msg)

        await logEnvio(p.id, user.id, envio.status, envio.provider_id, envio.erro, envio.payload)

        // Confirmado OU pendente (timeout, mas provavelmente enviou) → marca qr_enviado_em.
        // Admin pode reenviar manualmente se participante reclamar que não recebeu.
        if (envio.status === 'enviado' || envio.status === 'pendente') {
          await supaRest('participantes?id=eq.' + p.id, {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: { qr_enviado_em: new Date().toISOString() },
          })
        }

        results.push({
          id: p.id, nome: p.nome,
          ok: envio.status === 'enviado',
          pendente: envio.status === 'pendente',
          erro: envio.erro,
        })
      } catch (e) {
        console.error('erro ao enviar QR pra', p && p.id, e)
        await logEnvio(p.id, user.id, 'erro', null, e.message, null)
        results.push({ id: p.id, nome: p && p.nome, ok: false, erro: e.message })
      }
    }

    var enviados = results.filter(function(r){ return r.ok }).length
    var pendentes = results.filter(function(r){ return r.pendente }).length
    var erros = results.length - enviados - pendentes
    return res.status(200).json({
      ok: true,
      enviados: enviados,
      pendentes: pendentes,
      erros: erros,
      total: results.length,
      results: results,
    })

  } catch (err) {
    console.error('enviar-qr erro geral:', err)
    return res.status(500).json({ error: 'erro_interno', detail: err && err.message })
  }
}
