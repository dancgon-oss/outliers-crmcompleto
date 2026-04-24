// supabase/functions/asaas-webhook/index.ts
//
// Recebe notificações do Asaas sobre mudanças em payments.
// Requisitos atendidos:
//   - Validação: header `asaas-access-token` obrigatório (configure no painel Asaas)
//   - Idempotência: dedup por event.id (Asaas envia) ou tupla (event, payment.id, payment.status)
//   - Logging: TODO webhook entra em webhook_logs, mesmo os que não encontram parcela
//   - Sync cliente: após atualizar parcela, recalcula status do cliente (Ativo/Inadimplente)

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

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // ── 1. Autenticação ───────────────────────────────────────────
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

  // ── 2. Log ANTES de processar (rastro completo, inclusive eventos ignorados) ──
  const dedupKey = eventId || `${event || 'UNKNOWN'}|${payment?.id || 'NOPAY'}|${payment?.status || 'NOSTATUS'}`

  // Dedup via containment em JSONB: o operador @> é estável e bem indexado,
  // diferente do path filter. Busca qualquer webhook_logs com esse _dedup_key.
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

  // Se evento não é de interesse, loga e sai
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

  // ── 3. Buscar parcela pelo payment.id ──────────────────────────
  if (!payment?.id) {
    await supabase.from('webhook_logs').insert({
      evento: event, asaas_payment_id: null, parcela_id: null, status_novo: null, payload: payloadLog,
    })
    return new Response(JSON.stringify({ ok: true, missingPaymentId: true }), { status: 200 })
  }

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, financeiro_id, financeiro:financeiro_id(cliente_id)')
    .eq('asaas_payment_id', payment.id)
    .maybeSingle()

  if (!parcela) {
    // Orfão: loga mesmo assim pra ficarmos sabendo
    await supabase.from('webhook_logs').insert({
      evento: event, asaas_payment_id: payment.id, parcela_id: null, status_novo: null, payload: payloadLog,
    })
    return new Response(JSON.stringify({ ok: true, notFound: true, paymentId: payment.id }), { status: 200 })
  }

  const novoStatus = STATUS_MAP[event]

  // Se já está no status, ainda loga mas não atualiza
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

  // ── 4. Atualiza parcela ───────────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    status: novoStatus,
    asaas_status: payment.status,
    updated_at: new Date().toISOString(),
  }
  if (novoStatus === 'Pago') updatePayload.pago_em = new Date().toISOString()
  if (novoStatus === 'Pendente') updatePayload.pago_em = null

  await supabase.from('parcelas').update(updatePayload).eq('id', parcela.id)

  // ── 5. Sincroniza status do cliente ───────────────────────────
  // Regra: qualquer parcela Atrasada → cliente Inadimplente.
  //        Caso contrário, se estava Inadimplente → volta pra Ativo.
  const clienteId = (parcela as any)?.financeiro?.cliente_id
  if (clienteId) {
    const { data: todasParcelas } = await supabase
      .from('parcelas')
      .select('status, financeiro:financeiro_id!inner(cliente_id)')
      .filter('financeiro.cliente_id', 'eq', clienteId)

    const temAtrasada = (todasParcelas ?? []).some((p: any) => p.status === 'Atrasado')

    const { data: cliente } = await supabase
      .from('clientes')
      .select('status')
      .eq('id', clienteId)
      .maybeSingle()

    if (cliente) {
      if (temAtrasada && cliente.status !== 'Inadimplente') {
        await supabase.from('clientes').update({ status: 'Inadimplente' }).eq('id', clienteId)
      } else if (!temAtrasada && cliente.status === 'Inadimplente') {
        await supabase.from('clientes').update({ status: 'Ativo' }).eq('id', clienteId)
      }
    }
  }

  // ── 6. Log final ──────────────────────────────────────────────
  await supabase.from('webhook_logs').insert({
    evento: event,
    asaas_payment_id: payment.id,
    parcela_id: parcela.id,
    status_novo: novoStatus,
    payload: payloadLog,
  })

  return new Response(JSON.stringify({ ok: true, status: novoStatus }), { status: 200 })
})
