// supabase/functions/asaas-webhook/index.ts
//
// Recebe notificacoes do Asaas sobre mudancas em payments.
// Requisitos atendidos:
//   - Validacao: header `asaas-access-token` obrigatorio
//   - Idempotencia: dedup por event.id ou tupla (event, payment.id, payment.status)
//   - Sync cliente: Ativo/Inadimplente
//   - LIBERACAO DE COMISSOES: quando parcela vira Pago, o trigger SQL
//     `tg_parcela_paga_trg` cria movimentos de liberacao automaticamente
//     E cria notificacao na tabela `notificacoes`
//   - WHATSAPP: notifica admin via Z-API (env ADMIN_NOTIFY_PHONE,
//     ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN opcional)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EVENTOS_INTERESSE = new Set([
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
])

const STATUS_MAP: Record<string, string> = {
  PAYMENT_RECEIVED: 'Pago',
  PAYMENT_CONFIRMED: 'Pago',
  PAYMENT_OVERDUE: 'Atrasado',
  PAYMENT_DELETED: 'Pendente',
  PAYMENT_REFUNDED: 'Pendente',
}

function fmtBRL(n: number) {
  try { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) } catch { return 'R$ ' + n.toFixed(2) }
}

async function notifyAdminWhatsApp(args: { clienteNome?: string; valor?: number; numero?: number | null; total?: number | null }) {
  try {
    const phone = (Deno.env.get('ADMIN_NOTIFY_PHONE') ?? '').replace(/\D/g, '')
    const instance = Deno.env.get('ZAPI_INSTANCE_ID') ?? ''
    const token = Deno.env.get('ZAPI_TOKEN') ?? ''
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? ''
    if (!phone || !instance || !token) {
      console.log('[whatsapp] envs ausentes - notificacao pulada')
      return
    }
    const valorStr = typeof args.valor === 'number' ? fmtBRL(args.valor) : ''
    const linhaParc = args.numero
      ? `Parcela ${args.numero}${args.total ? '/' + args.total : ''}`
      : 'Pagamento'
    const msg = [
      'Outliers CRM - Pagamento recebido',
      '',
      'Cliente: ' + (args.clienteNome || '(sem nome)'),
      linhaParc + (valorStr ? ' - ' + valorStr : ''),
      '',
      'Comissoes da parcela foram liberadas no fluxo.',
    ].join('\n')

    const url = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (clientToken) headers['Client-Token'] = clientToken
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone, message: msg }),
    })
    if (!r.ok) {
      const tx = await r.text().catch(() => '')
      console.log('[whatsapp] falha', r.status, tx)
    }
  } catch (e) {
    console.log('[whatsapp] erro', e)
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
  const gotToken =
    req.headers.get('asaas-access-token') ||
    req.headers.get('Asaas-Access-Token') ||
    req.headers.get('asaas_access_token') ||
    ''
  if (expectedToken && gotToken !== expectedToken) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  let body: any
  try { body = await req.json() } catch { return new Response('invalid json', { status: 400 }) }

  const event = body?.event as string | undefined
  const payment = body?.payment
  const eventId = body?.id as string | undefined

  // Dedup
  const dedupKey = eventId || `${event || 'UNKNOWN'}|${payment?.id || 'NOPAY'}|${payment?.status || 'NOSTATUS'}`
  const { data: jaLogado } = await supabase
    .from('webhook_logs')
    .select('id')
    .contains('payload', { _dedup_key: dedupKey })
    .limit(1)
    .maybeSingle()
  if (jaLogado) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 })
  }

  const payloadLog = { ...body, _dedup_key: dedupKey }

  if (!event || !EVENTOS_INTERESSE.has(event)) {
    await supabase.from('webhook_logs').insert({
      evento: event || 'UNKNOWN',
      asaas_payment_id: payment?.id ?? null,
      parcela_id: null,
      status_novo: null,
      payload: payloadLog,
    })
    return new Response(JSON.stringify({ ok: true, skipped: true, event }), { status: 200 })
  }

  if (!payment?.id) {
    await supabase.from('webhook_logs').insert({
      evento: event, asaas_payment_id: null, parcela_id: null, status_novo: null, payload: payloadLog,
    })
    return new Response(JSON.stringify({ ok: true, missingPaymentId: true }), { status: 200 })
  }

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, numero, valor, financeiro_id, financeiro:financeiro_id(cliente_id, valor_total)')
    .eq('asaas_payment_id', payment.id)
    .maybeSingle()

  if (!parcela) {
    await supabase.from('webhook_logs').insert({
      evento: event, asaas_payment_id: payment.id, parcela_id: null, status_novo: null, payload: payloadLog,
    })
    return new Response(JSON.stringify({ ok: true, notFound: true, paymentId: payment.id }), { status: 200 })
  }

  const novoStatus = STATUS_MAP[event]

  if (!novoStatus || parcela.status === novoStatus) {
    await supabase.from('webhook_logs').insert({
      evento: event,
      asaas_payment_id: payment.id,
      parcela_id: parcela.id,
      status_novo: novoStatus ?? null,
      payload: payloadLog,
    })
    return new Response(JSON.stringify({ ok: true, noChange: true }), { status: 200 })
  }

  const updatePayload: Record<string, unknown> = {
    status: novoStatus,
    asaas_status: payment.status,
    updated_at: new Date().toISOString(),
  }
  if (novoStatus === 'Pago') updatePayload.pago_em = new Date().toISOString()
  if (novoStatus === 'Pendente') updatePayload.pago_em = null

  // O trigger SQL `tg_parcela_paga_trg` libera comissoes e cria notificacao.
  await supabase.from('parcelas').update(updatePayload).eq('id', parcela.id)

  // Sync cliente Ativo/Inadimplente
  const clienteId = (parcela as any)?.financeiro?.cliente_id
  if (clienteId) {
    const { data: todasParcelas } = await supabase
      .from('parcelas')
      .select('status, financeiro:financeiro_id!inner(cliente_id)')
      .filter('financeiro.cliente_id', 'eq', clienteId)

    const temAtrasada = (todasParcelas ?? []).some((p: any) => p.status === 'Atrasado')

    const { data: cliente } = await supabase
      .from('clientes')
      .select('status, nome')
      .eq('id', clienteId)
      .maybeSingle()

    if (cliente) {
      if (temAtrasada && cliente.status !== 'Inadimplente') {
        await supabase.from('clientes').update({ status: 'Inadimplente' }).eq('id', clienteId)
      } else if (!temAtrasada && cliente.status === 'Inadimplente') {
        await supabase.from('clientes').update({ status: 'Ativo' }).eq('id', clienteId)
      }
    }

    // WhatsApp pro admin so quando virou Pago
    if (novoStatus === 'Pago') {
      const { count: totalParcelas } = await supabase
        .from('parcelas')
        .select('id', { count: 'exact', head: true })
        .eq('financeiro_id', parcela.financeiro_id)
      await notifyAdminWhatsApp({
        clienteNome: cliente?.nome,
        valor: Number(parcela.valor),
        numero: (parcela as any).numero,
        total: totalParcelas ?? null,
      })
    }
  }

  await supabase.from('webhook_logs').insert({
    evento: event,
    asaas_payment_id: payment.id,
    parcela_id: parcela.id,
    status_novo: novoStatus,
    payload: payloadLog,
  })

  return new Response(JSON.stringify({ ok: true, status: novoStatus }), { status: 200 })
})
