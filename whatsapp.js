// ─────────────────────────────────────────────────────────────
//  Outliers · Webhook WhatsApp + Andréia IA
//  Vercel API Route: /api/whatsapp
//  Recebe mensagens da Z-API → responde com IA → salva lead no CRM
// ─────────────────────────────────────────────────────────────

// Memória de conversas por número (em produção use Redis ou Supabase)
const conversas = {}

const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY

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
- Não use markdown com asteriscos — o WhatsApp usa *negrito* com asterisco simples`

export default async function handler(req, res) {
  // Z-API envia GET para verificar o webhook
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', agente: 'Andréia - Outliers' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  try {
    const body = req.body

    // Ignorar mensagens do próprio número, grupos e status
    if (
      body.fromMe ||
      body.isGroup ||
      body.type === 'ReceivedCallback' && body.chatId?.includes('@g.us')
    ) {
      return res.status(200).json({ status: 'ignorado' })
    }

    const telefone = body.phone || body.chatId?.replace('@c.us', '') || ''
    const mensagem = body.text?.message || body.listResponseMessage?.title || ''

    if (!mensagem || !telefone) {
      return res.status(200).json({ status: 'sem mensagem' })
    }

    // Inicializar histórico de conversa se não existir
    if (!conversas[telefone]) {
      conversas[telefone] = {
        historico: [],
        leadSalvo: false,
        dadosLead: {}
      }
    }

    const conversa = conversas[telefone]

    // Adicionar mensagem do usuário ao histórico
    conversa.historico.push({
      role: 'user',
      content: mensagem
    })

    // Limitar histórico a 20 mensagens para não exceder o contexto
    if (conversa.historico.length > 20) {
      conversa.historico = conversa.historico.slice(-20)
    }

    // ── Chamar a IA ──────────────────────────────────────────
    const iaResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
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
    const resposta = iaData.content?.[0]?.text || 'Desculpe, tive um problema. Pode repetir?'

    // ── Verificar se captou o lead ───────────────────────────
    const matchLead = resposta.match(/DADOS_LEAD:(\{.*?\})/s)
    if (matchLead && !conversa.leadSalvo) {
      try {
        const dadosLead = JSON.parse(matchLead[1])
        dadosLead.telefone = dadosLead.telefone || telefone

        // Salvar no CRM (Supabase)
        await fetch(`${SUPABASE_URL}/functions/v1/captar-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'apikey': SUPABASE_KEY
          },
          body: JSON.stringify(dadosLead)
        })

        conversa.leadSalvo = true
        conversa.dadosLead = dadosLead
        console.log('✅ Lead salvo no CRM:', dadosLead)
      } catch (e) {
        console.error('Erro ao salvar lead:', e)
      }
    }

    // ── Limpar o bloco DADOS_LEAD da resposta ────────────────
    const respostaLimpa = resposta
      .replace(/DADOS_LEAD:\{.*?\}/s, '')
      .trim()

    // Adicionar resposta da IA ao histórico
    conversa.historico.push({
      role: 'assistant',
      content: resposta
    })

    // ── Enviar resposta via Z-API ─────────────────────────────
    await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: telefone,
          message: respostaLimpa
        })
      }
    )

    return res.status(200).json({ status: 'ok', leadSalvo: conversa.leadSalvo })

  } catch (err) {
    console.error('Erro no webhook:', err)
    return res.status(500).json({ error: 'Erro interno' })
  }
}
