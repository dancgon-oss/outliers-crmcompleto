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
    const instanceId = process.env.ZAPI_INSTANCE_ID
    const token = process.env.ZAPI_TOKEN
    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`

    // Ignorar grupos
    const chatId = body.chatId || ''
    const chatLid = body.chatLid || ''
    if (chatId.includes('@g.us') || body.isGroup === true) {
      console.log('Ignorado: grupo')
      return res.status(200).json({ status: 'grupo_ignorado' })
    }

    // Ignorar mensagens enviadas por mim
    if (body.fromMe === true && body.messageId) {
      console.log('Ignorado: fromMe')
      return res.status(200).json({ status: 'fromMe_ignorado' })
    }

    // Extrair mensagem
    const mensagem =
      body.text?.message ||
      body.message?.conversation ||
      body.message?.extendedTextMessage?.text ||
      body.textMessage ||
      (typeof body.message === 'string' ? body.message : '') ||
      ''

    // ── DESTINO: usar chatLid completo se disponível (suportado pela Z-API)
    // Documentação Z-API: @lid pode ser usado diretamente como phone
    const destino = chatLid || body.phone || chatId

    // Chave para o histórico (usar parte numérica)
    const chaveHistorico = destino.split('@')[0] || destino

    console.log('chatLid:', chatLid)
    console.log('chatId:', chatId)
    console.log('phone:', body.phone)
    console.log('destino final:', destino)
    console.log('mensagem:', mensagem)

    if (!mensagem || !destino) {
      console.log('Sem dados — ignorando. mensagem:', !!mensagem, 'destino:', !!destino)
      return res.status(200).json({ status: 'sem_dados' })
    }

    // Histórico de conversa
    if (!conversas[chaveHistorico]) conversas[chaveHistorico] = { historico: [], leadSalvo: false }
    const conv = conversas[chaveHistorico]
    conv.historico.push({ role: 'user', content: mensagem })
    if (conv.historico.length > 20) conv.historico = conv.historico.slice(-20)

    // Chamar IA
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
    if (iaRes.status !== 200) {
      console.error('Erro IA:', JSON.stringify(iaData))
      return res.status(200).json({ status: 'erro_ia' })
    }

    const resposta = iaData.content?.[0]?.text || 'Oi! Sou a Andréia da equipe do Lucas Labastie. Como posso te ajudar?'
    console.log('Resposta IA:', resposta.substring(0, 150))

    // Salvar lead
    const leadMatch = resposta.match(/DADOS_LEAD:(\{.*?\})/s)
    if (leadMatch && !conv.leadSalvo) {
      try {
        const lead = JSON.parse(leadMatch[1])
        lead.telefone = lead.telefone || body.phone || chaveHistorico
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/captar-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'apikey': process.env.SUPABASE_SERVICE_KEY
          },
          body: JSON.stringify(lead)
        })
        console.log('✅ Lead salvo:', lead)
        conv.leadSalvo = true
      } catch (e) {
        console.error('Erro lead:', e.message)
      }
    }

    const respostaFinal = resposta.replace(/DADOS_LEAD:\{.*?\}/s, '').trim()
    conv.historico.push({ role: 'assistant', content: resposta })

    // ── Enviar via Z-API usando destino completo (com @lid se necessário)
    console.log('Enviando para Z-API:', destino)
    const zapiRes = await fetch(`${baseUrl}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: destino, message: respostaFinal })
    })

    const zapiText = await zapiRes.text()
    console.log('Z-API status:', zapiRes.status, '| resposta:', zapiText)

    return res.status(200).json({ ok: true, zapiStatus: zapiRes.status })

  } catch (err) {
    console.error('ERRO GERAL:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
