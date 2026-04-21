// ─────────────────────────────────────────────────────────────
//  Outliers CRM · Edge Function: captar-lead
//  Recebe os dados do agente de IA e salva na tabela `clientes`
// ─────────────────────────────────────────────────────────────
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {

  // Responde ao preflight do CORS (obrigatório para chamadas do navegador)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Lê os dados enviados pelo agente ──────────────────
    const { nome, email, telefone, treinamento } = await req.json()

    // Validação mínima
    if (!nome || !email || !telefone) {
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios: nome, email, telefone' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 2. Conecta ao Supabase com a service_role key ────────
    //    (usa variáveis de ambiente configuradas no Supabase Dashboard)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ── 3. Verifica se o lead já existe pelo e-mail ──────────
    const { data: existing } = await supabase
      .from('clientes')
      .select('id, nome, email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (existing) {
      // Lead já cadastrado — retorna sucesso sem duplicar
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Lead já existente',
          id: existing.id,
          duplicado: true
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 4. Insere o novo lead na tabela clientes ─────────────
    const { data, error } = await supabase
      .from('clientes')
      .insert({
        nome:          nome.trim(),
        email:         email.toLowerCase().trim(),
        telefone:      telefone.trim(),
        origem:        'Paradigma',           // sempre Imersão Paradigma
        status:        'Ativo',
        programa:      treinamento || 'Imersão Paradigma',
        observacoes:   `Lead captado automaticamente pelo Agente IA (${new Date().toLocaleDateString('pt-BR')})`,
        data_entrada:  new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single()

    if (error) {
      console.error('Erro ao inserir lead:', error)
      return new Response(
        JSON.stringify({ error: 'Erro ao salvar lead', detail: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 5. Retorna sucesso ───────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Lead salvo com sucesso!',
        id: data.id
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Erro inesperado:', err)
    return new Response(
      JSON.stringify({ error: 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
