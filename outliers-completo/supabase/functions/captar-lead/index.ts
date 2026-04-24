// ─────────────────────────────────────────────────────────────
//  Outliers CRM · Edge Function: captar-lead
//  Captura de leads de múltiplas fontes:
//   - Agente IA (WhatsApp via /api/whatsapp)
//   - Landings públicas (/outliers, /paradigma, /pqv, ...)
//  Schema: respeita CHECK constraints atuais de `origem` e `status`.
// ─────────────────────────────────────────────────────────────
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Valores aceitos pelo CHECK constraint atual em `clientes.origem`.
// Landings diferentes de Paradigma caem em 'Outro' até rodarmos migration.
const ORIGEM_VALIDA = new Set(['Paradigma', 'Indicação', 'Renovação', 'Outro'])

function normOrigem(o?: string) {
  if (!o) return 'Outro'
  return ORIGEM_VALIDA.has(o) ? o : 'Outro'
}

function sanitizeTel(t?: string) {
  if (!t) return ''
  return String(t).replace(/\D/g, '')
}

function sanitizeCpf(c?: string) {
  if (!c) return null
  const only = String(c).replace(/\D/g, '')
  return only.length === 11 ? only : null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const {
      nome,
      email,
      telefone,
      cpf,
      treinamento,    // compat com agente IA (legado)
      programa,       // novo: 'Outliers' | 'Paradigma' | 'PQV' | 'Método Cash' | 'Cursos Online' | ...
      origem,         // novo: 'Paradigma' | 'Indicação' | 'Renovação' | 'Outro'
      landing_slug,   // novo: identifica qual landing gerou o lead (ex: 'outliers', 'pqv')
      utm_source,
      utm_medium,
      utm_campaign,
      observacoes_extras,
    } = body || {}

    if (!nome || !email || !telefone) {
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios: nome, email, telefone' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const emailNorm = String(email).toLowerCase().trim()
    const telNorm = sanitizeTel(telefone)
    const cpfNorm = sanitizeCpf(cpf)

    // Dedup por e-mail
    const { data: existing } = await supabase
      .from('clientes')
      .select('id')
      .eq('email', emailNorm)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({ success: true, message: 'Lead já existente', id: existing.id, duplicado: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Monta observações com todo o rastro para não perder informação
    const rastro: string[] = []
    rastro.push(`Captado em ${new Date().toLocaleDateString('pt-BR')}`)
    if (landing_slug) rastro.push(`landing=${landing_slug}`)
    if (utm_source) rastro.push(`utm_source=${utm_source}`)
    if (utm_medium) rastro.push(`utm_medium=${utm_medium}`)
    if (utm_campaign) rastro.push(`utm_campaign=${utm_campaign}`)
    if (observacoes_extras) rastro.push(String(observacoes_extras))

    const programaFinal = programa || treinamento || 'Outliers'
    const origemFinal = normOrigem(origem || (landing_slug ? 'Outro' : 'Paradigma'))

    const insertPayload: Record<string, unknown> = {
      nome: String(nome).trim(),
      email: emailNorm,
      telefone: telNorm,
      origem: origemFinal,
      status: 'Ativo',
      stage: 'Novo',                 // entra direto no kanban comercial
      programa: programaFinal,
      observacoes: rastro.join(' | '),
      data_entrada: new Date().toISOString().split('T')[0],
    }
    if (cpfNorm) insertPayload.cpf = cpfNorm

    const { data, error } = await supabase
      .from('clientes')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('Erro ao inserir lead:', error)
      return new Response(
        JSON.stringify({ error: 'Erro ao salvar lead', detail: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Lead salvo com sucesso!', id: data.id }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('Erro inesperado:', err)
    return new Response(
      JSON.stringify({ error: 'Erro interno', detail: err?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
