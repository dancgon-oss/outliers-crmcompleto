// supabase/functions/asaas-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const body = await req.json()
    const { event, payment } = body

    const EVENTOS = ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_REFUNDED']
    if (!EVENTOS.includes(event)) return new Response(JSON.stringify({ ok:true, skipped:true }), { status:200 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: parcela } = await supabase.from('parcelas').select('id,status').eq('asaas_payment_id', payment.id).single()
    if (!parcela) return new Response(JSON.stringify({ ok:true, notFound:true }), { status:200 })

    const statusMap = { PAYMENT_RECEIVED:'Pago', PAYMENT_CONFIRMED:'Pago', PAYMENT_OVERDUE:'Atrasado', PAYMENT_DELETED:'Pendente', PAYMENT_REFUNDED:'Pendente' }
    const novoStatus = statusMap[event]
    if (!novoStatus || parcela.status === novoStatus) return new Response(JSON.stringify({ ok:true, noChange:true }), { status:200 })

    await supabase.from('parcelas').update({
      status: novoStatus,
      asaas_status: payment.status,
      pago_em: novoStatus === 'Pago' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', parcela.id)

    await supabase.from('webhook_logs').insert({ evento:event, asaas_payment_id:payment.id, parcela_id:parcela.id, status_novo:novoStatus, payload:body })

    return new Response(JSON.stringify({ ok:true, status:novoStatus }), { status:200 })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status:500 })
  }
})
