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
- Você está respondendo via WhatsApp — use linguagem informal e amigável
- Não use markdown com asteriscos duplos — use *negrito* com asterisco simples se precisar`

export default async function handler(req, res) {
  // Log completo do body para debug
  console.log('=== WEBHOOK RECEBIDO ===')
  console.log('Method:', req.method)
  console.log('Body:', JSON.stringify(req.body, null, 2))

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', agente: 'Andréia - Outliers' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const body = req.body || {}

    // ── Extrair telefone e mensagem em múltiplos formatos Z-API ──
    const fromMe = body.fromMe === true || body.fromMe === 'true'
    const isGroup = (body.chatId || '').includes('@g.us') || body.isGroup === true

    // Ignorar mensagens enviadas por mim ou de grupos
    if (fromMe || isGroup) {
      console.log('Ignorado: fromMe ou grupo')
      return res.status(200).json({ status: 'ignorado' })
    }

    // Extrair telefone
    const telefone =
      body.phone ||
      (body.chatId ? body.chatId.replace('@c.us', '') : '') ||
      body.sender?.replace('@c.us', '') ||
      ''

    // Extrair texto da mensagem em todos os formatos possíveis da Z-API
    const mensagem =
      body.text?.message ||
      body.message?.text ||
      body.textMessage ||
      body.body ||
      (typeof body.message === 'string' ? body.message : '') ||
      ''

    console.log('Telefone:', telefone)
    console.log('Mensagem:', mensagem)

    if (!mensagem || !telefone) {
      console.log('Sem mensagem ou telefone — ignorando')
      return res.status(200).json({ status: 'sem_dados' })
    }

    // Inicializar histórico
    if (!conversas[telefone]) {
      conversas[telefone] = { historico: [], leadSalvo: false }
    }
    const conversa = conversas[telefone]

    conversa.historico.push({ role: 'user', content: mensagem })
    if (conversa.historico.length > 20) {
      conversa.historico = conversa.historico.slice(-20)
    }

    // ── Chamar a IA ──────────────────────────────────────────────
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
    console.log('IA Status:', iaResponse.status)

    const resposta = iaData.content?.[0]?.text || 'Oi! Tudo bem? Sou a Andréia, da equipe do Lucas Labastie. Como posso te ajudar?'

    // ── Verificar lead ───────────────────────────────────────────
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
        console.log('✅ Lead salvo:', dadosLead)
      } catch (e) {
        console.error('Erro ao salvar lead:', e)
      }
    }

    // Limpar bloco DADOS_LEAD da resposta
    const respostaLimpa = resposta.replace(/DADOS_LEAD:\{.*?\}/s, '').trim()
    conversa.historico.push({ role: 'assistant', content: resposta })

    // ── Enviar resposta via Z-API ─────────────────────────────────
    const zapiUrl = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`
    console.log('Enviando para Z-API:', zapiUrl)

    const zapiResp = await fetch(zapiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: telefone, message: respostaLimpa })
    })

    const zapiData = await zapiResp.json()
    console.log('Z-API resposta:', JSON.stringify(zapiData))

    return res.status(200).json({ status: 'ok' })

  } catch (err) {
    console.error('Erro no webhook:', err)
    return res.status(500).json({ error: err.message })
  }
}
