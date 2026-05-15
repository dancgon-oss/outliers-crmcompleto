// Outliers CRM - cria documento no ZapSign a partir de PDF base64
// Requer envs: SUPABASE_URL, SUPABASE_SERVICE_KEY (ou SERVICE_ROLE_KEY),
//              ZAPSIGN_API_TOKEN
import { createClient } from '@supabase/supabase-js'

function sanitize(s) {
  if (!s) return s
  var out = ''
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c >= 33 && c <= 126) out += s.charAt(i)
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  var url = sanitize(process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL)
  var serviceKey = sanitize(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)
  var zapToken = sanitize(process.env.ZAPSIGN_API_TOKEN || '')
  if (!url || !serviceKey) return res.status(500).json({ error: 'Servidor sem SUPABASE_URL/SERVICE_KEY.' })
  if (!zapToken) return res.status(500).json({ error: 'Servidor sem ZAPSIGN_API_TOKEN configurada.' })

  try {
    var token = sanitize((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
    if (!token) return res.status(401).json({ error: 'Sem token de autenticacao.' })

    var admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    var ures = await admin.auth.getUser(token)
    if (ures.error || !ures.data || !ures.data.user) return res.status(401).json({ error: 'Token invalido.' })
    var callerId = ures.data.user.id
    var p = await admin.from('profiles').select('role').eq('id', callerId).single()
    if (p.error || !p.data || ['admin','financeiro','comercial'].indexOf(p.data.role) === -1) {
      return res.status(403).json({ error: 'Apenas admin/financeiro/comercial.' })
    }

    var body = req.body || {}
    // Pode ser muito grande (PDF base64) — Vercel tem limite ~4.5MB no body por padrao
    var financeiro_id = body.financeiro_id
    var pdf_base64 = body.pdf_base64 || ''        // sem prefixo "data:application/pdf;base64,"
    var pdf_url = body.pdf_url || ''              // alternativa: URL publica do PDF
    var doc_name = (body.doc_name || 'Contrato').trim()
    var signer_email = (body.signer_email || '').trim().toLowerCase()
    var signer_nome  = (body.signer_nome || '').trim()
    var observacoes  = body.observacoes || null

    if (!financeiro_id) return res.status(400).json({ error: 'financeiro_id obrigatorio.' })
    if (!signer_email || !signer_nome) return res.status(400).json({ error: 'signer_nome e signer_email obrigatorios.' })
    if (!pdf_base64 && !pdf_url) return res.status(400).json({ error: 'Envie pdf_base64 OU pdf_url.' })

    // Busca dados da venda + cliente
    var fin = await admin.from('financeiro').select('id, cliente_id, valor_total, clientes:cliente_id(nome,email,cpf,telefone)').eq('id', financeiro_id).maybeSingle()
    if (fin.error || !fin.data) return res.status(400).json({ error: 'Venda nao encontrada.' })
    var cliente_id = fin.data.cliente_id

    // Cria documento no ZapSign
    var zapBody = {
      name: doc_name,
      external_id: 'fin-' + financeiro_id,
      lang: 'pt-br',
      disable_signer_emails: false,
      brand_logo: '',
      brand_primary_color: '#c9a96e',
      signers: [
        {
          name: signer_nome,
          email: signer_email,
          auth_mode: 'assinaturaTela',
          send_automatic_email: true,
          send_automatic_whatsapp: false,
        }
      ],
    }
    if (pdf_base64) zapBody.base64_pdf = pdf_base64
    if (pdf_url)    zapBody.url_pdf    = pdf_url

    var zapResp = await fetch('https://api.zapsign.com.br/api/v1/docs/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + zapToken },
      body: JSON.stringify(zapBody),
    })
    var zapData = await zapResp.json().catch(function(){ return {} })
    if (!zapResp.ok) {
      return res.status(400).json({ error: 'ZapSign: ' + (zapData.message || zapData.detail || JSON.stringify(zapData)) })
    }

    // Pega link de assinatura do primeiro signer
    var primeiro = (zapData.signers && zapData.signers[0]) || {}
    var insertC = {
      cliente_id:        cliente_id,
      financeiro_id:     financeiro_id,
      zapsign_doc_id:    zapData.open_id || zapData.token || null,
      zapsign_doc_token: zapData.token || null,
      link_assinatura:   primeiro.sign_url || null,
      pdf_original_url:  zapData.original_file || null,
      signer_email:      signer_email,
      signer_nome:       signer_nome,
      status:            'Aguardando',
      enviado_em:        new Date().toISOString(),
      texto_contrato:    observacoes || null,
      payload_zapsign:   zapData,
    }
    var ci = await admin.from('contratos').insert(insertC).select().single()
    if (ci.error) return res.status(500).json({ error: 'Erro ao salvar contrato: ' + ci.error.message })

    return res.status(200).json({
      ok: true,
      contrato_id: ci.data.id,
      link_assinatura: primeiro.sign_url || null,
      doc_id: zapData.token || null,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}

export var config = {
  api: {
    bodyParser: { sizeLimit: '10mb' }, // PDFs base64 podem passar de 4.5MB
  },
}
