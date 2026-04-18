// Outliers · Webhook WhatsApp + Andréia IA
// Vercel API Route: /api/whatsapp

const conversas = {}

const SYSTEM_PROMPT = `Você é a Andréia, faz parte da equipe do Lucas Labastie — treinador da Imersão Paradigma.

Contexto:
- Único treinamento disponível para novos alunos: Imersão Paradigma.
- Outros treinamentos são exclusivos para quem já comprou o Outliers durante a Imersão.
- Se perguntarem sobre outros treinamentos, explique que são exclusivos para alunos da Imersão.

Objetivo:
1. Recepcionar com calor e entusiasmo
2. Responder dúvidas sobre a Imersão Paradigma
3. Coletar nome completo, e-mail e telefone naturalmente
4. Quando tiver os três dados, inclua no final da resposta:
   DADOS_LEAD:{"nome":"...","email":"...","telefone":"...","treinamento":"Imersão Paradigma"}

Regras:
- Sempre em português do Brasil, calorosa e humana
- Respostas curtas (máximo 3 parágrafos)
- Linguagem informal e amigável (WhatsApp)
- Não invente informações sobre a Imersão`

export default async function handler(req, res) {
  console.log('=== WEBHOOK ===')
  console.log('Body:', JSON.stringify(req.body, null, 2))

  if (req.method === 'GET') return res.status(200).json({ ok: true })
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const body = req.body || {}

    // Ignorar grupos
    const chatId = body.chatId || ''
    if (chatId.includes('@g.us') || body.isGroup === true) {
      console.log('Ignorado: grupo')
      return res.status(200).json({ status: 'grupo_ignorado' })
    }

    // Ignorar mensagens enviadas por mim
    if (body.fromMe === true && body.messageId) {
      console.log('Ignorado: fromMe')
      return res.status(200).json({ status: 'fromMe_ignorado' })
    }

    // Extrair mensagem em todos os formatos Z-API
    const mensagem =
      body.text?.message ||
      body.message?.conversation ||
      body.message?.extendedTextMessage?.text ||
      body.textMessage ||
      (typeof body.message === 'string' ? body.message : '') ||
      ''

    // Extrair telefone — suporta @c.us, @lid e phone direto
    const telefone =
      body.phone ||
      body.sender?.split('@')[0] ||
      chatId.split('@')[0] ||
      ''

    console.log('Telefone:', telefone)
    console.log('Mensagem:', mensagem)

    if (!mensagem || !telefone) {
      console.log('Sem dados — ignorando')
      return res.status(200).json({ status: 'sem_dados' })
    }

    // Histórico de conversa por número
    if (!conversas[telefone]) conversas[telefone] = { historico: [], leadSalvo: false }
    const conv = conversas[telefone]
    conv.historico.push({ role: 'user', content: mensagem })
    if (conv.historico.length > 20) conv.historico = conv.historico.slice(-20)

    // ── Chamar a IA ─────────────────────────────────────────
    console.log('Chamando IA...')
    const iaRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: conv.historico
      })
    })

    const iaData = await iaRes.json()
    console.log('IA status:', iaRes.status)
    const resposta = iaData.content?.[0]?.text || 'Oi! Sou a Andréia da equipe do Lucas Labastie. Como posso te ajudar?'
    console.log('Resposta IA:', resposta.substring(0, 100))

    // ── Salvar lead se capturado ─────────────────────────────
    const leadMatch = resposta.match(/DADOS_LEAD:(\{.*?\})/s)
    if (leadMatch && !conv.leadSalvo) {
      try {
        const lead = JSON.parse(leadMatch[1])
        lead.telefone = lead.telefone || telefone
        const r = await fetch(`${process.env.SUPABASE_URL}/functions/v1/captar-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'apikey': process.env.SUPABASE_SERVICE_KEY
          },
          body: JSON.stringify(lead)
        })
        console.log('Lead salvo, status:', r.status)
        conv.leadSalvo = true
      } catch (e) {
        console.error('Erro ao salvar lead:', e.message)
      }
    }

    const respostaFinal = resposta.replace(/DADOS_LEAD:\{.*?\}/s, '').trim()
    conv.historico.push({ role: 'assistant', content: resposta })

    // ── Enviar via Z-API — SEM Client-Token (não habilitado) ─
    const instanceId = process.env.ZAPI_INSTANCE_ID
    const token = process.env.ZAPI_TOKEN
    const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`
    const destino = body.phone || chatId

    console.log('Enviando para Z-API, destino:', destino)

    const zapiRes = await fetch(zapiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // Client-Token removido — token de segurança inativo na conta
      },
      body: JSON.stringify({
        phone: destino,
        message: respostaFinal
      })
    })

    const zapiData = await zapiRes.json()
    console.log('Z-API status:', zapiRes.status, '| resposta:', JSON.stringify(zapiData))

    return res.status(200).json({ ok: true, zapiStatus: zapiRes.status })

  } catch (err) {
    console.error('ERRO GERAL:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
