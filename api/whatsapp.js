// Outliers · Webhook WhatsApp + Andréia IA
// Vercel API Route: /api/whatsapp

const conversas = {}

const SYSTEM_PROMPT = `Você é a Andréia, faz parte da equipe do Lucas Labastie — treinador da Imersão Paradigma.

Contexto importante:
- O único treinamento disponível para novos alunos é a Imersão Paradigma. É sempre o primeiro passo.
- Os outros treinamentos (PQV, Método Cash, Outliers, Mentoria Lucas Labastie, MentoCash VendasNow) são EXCLUSIVOS para quem já comprou o programa Outliers durante a Imersão Paradigma.
- Se alguém perguntar sobre os outros treinamentos, explique que são exclusivos para alunos da Imersão.

Seu objetivo:
1. Recepcionar o contato com calor e entusiasmo
2. Responder dúvidas sobre a Imersão Paradigma
3. Coletar nome completo, e-mail e telefone de forma natural durante a conversa
4. Quando tiver os três dados, confirme e inclua no final da resposta:
   DADOS_LEAD:{"nome":"...","email":"...","telefone":"...","treinamento":"Imersão Paradigma"}

Regras:
- Converse SEMPRE em português do Brasil, de forma calorosa e humana
- Não invente detalhes sobre a Imersão que não foram fornecidos
- Colete os dados naturalmente, não como um formulário frio
- Respostas curtas e objetivas (máximo 3 parágrafos)
- Você está respondendo via WhatsApp — linguagem informal e amigável`

export default async function handler(req, res) {
  console.log('=== WEBHOOK RECEBIDO ===')
  console.log('Body:', JSON.stringify(req.body, null, 2))

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' })
  }
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const body = req.body || {}

    // Ignorar grupos (@g.us)
    const chatId = body.chatId || ''
    const isGroup = chatId.includes('@g.us') || body.isGroup === true
    if (isGroup) {
      console.log('Ignorado: grupo')
      return res.status(200).json({ status: 'ignorado_grupo' })
    }

    // Ignorar mensagens enviadas por mim
    if (body.fromMe === true && body.messageId) {
      console.log('Ignorado: fromMe')
      return res.status(200).json({ status: 'ignorado_fromMe' })
    }

    // Extrair telefone — suporta @c.us e @lid (formato novo do WhatsApp)
    const telefone =
      body.phone ||
      body.sender?.split('@')[0] ||
      chatId.split('@')[0] ||  // funciona com @c.us e @lid
      body.from?.split('@')[0] ||
      ''

    // Extrair mensagem em todos os formatos Z-API
    const mensagem =
      body.text?.message ||
      body.message?.conversation ||
      body.message?.extendedTextMessage?.text ||
      body.textMessage ||
      body.body ||
      (typeof body.message === 'string' ? body.message : '') ||
      ''

    console.log('Telefone:', telefone)
    console.log('Mensagem:', mensagem)
    console.log('ChatId:', chatId)

    if (!mensagem || !telefone) {
      console.log('Sem mensagem ou telefone')
      return res.status(200).json({ status: 'sem_dados', telefone, mensagem, chatId })
    }

    // Histórico de conversa
    if (!conversas[telefone]) {
      conversas[telefone] = { historico: [], leadSalvo: false }
    }
    const conversa = conversas[telefone]
    conversa.historico.push({ role: 'user', content: mensagem })
    if (conversa.historico.length > 20) {
      conversa.historico = conversa.historico.slice(-20)
    }

    // Chamar a IA
    console.log('Chamando Anthropic...')
    const iaResponse = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: conversa.historico
      })
    })

    const iaData = await iaResponse.json()
    console.log('Anthropic status:', iaResponse.status)
    const resposta = iaData.content?.[0]?.text || 'Oi! Sou a Andréia da equipe do Lucas Labastie. Como posso te ajudar?'
    console.log('Resposta IA (100 chars):', resposta.substring(0, 100))

    // Verificar e salvar lead
    const matchLead = resposta.match(/DADOS_LEAD:(\{.*?\})/s)
    if (matchLead && !conversa.leadSalvo) {
      try {
        const dadosLead = JSON.parse(matchLead[1])
        dadosLead.telefone = dadosLead.telefone || telefone
        await fetch(`${process.env.SUPABASE_URL}/functions/v1/captar-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'apikey': process.env.SUPABASE_SERVICE_KEY
          },
          body: JSON.stringify(dadosLead)
        })
        conversa.leadSalvo = true
        console.log('Lead salvo:', dadosLead)
      } catch (e) {
        console.error('Erro ao salvar lead:', e)
      }
    }

    const respostaLimpa = resposta.replace(/DADOS_LEAD:\{.*?\}/s, '').trim()
    conversa.historico.push({ role: 'assistant', content: resposta })

    // Enviar via Z-API — usar chatId original para garantir entrega
    const destino = body.phone || chatId
    console.log('Enviando para:', destino)

    const zapiUrl = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`
    const zapiResp = await fetch(zapiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: destino, message: respostaLimpa })
    })
    const zapiData = await zapiResp.json()
    console.log('Z-API resposta:', JSON.stringify(zapiData))

    return res.status(200).json({ status: 'ok' })

  } catch (err) {
    console.error('ERRO:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
