// supabase/functions/marcar-atrasados/index.ts
//
// Job diário: marca parcelas Pendente com vencimento < hoje como "Atrasado".
// Fecha o ciclo mesmo quando o Asaas ainda não mandou PAYMENT_OVERDUE
// (ou quando a parcela nem tem cobrança Asaas emitida ainda).
//
// Após marcar, sincroniza status dos clientes afetados (Inadimplente se
// pelo menos uma parcela deles está Atrasada).
//
// Auth: header `authorization: Bearer <SCHEDULED_JOB_TOKEN>` obrigatório
// pra evitar qualquer um disparar isso. Se `SCHEDULED_JOB_TOKEN` não estiver
// setado, a função aceita chamadas sem auth (modo dev / manual).
//
// Uso:
//   curl -H "Authorization: Bearer $TOKEN" \
//     https://<project>.supabase.co/functions/v1/marcar-atrasados
//
// Configurar cron externo (cron-job.org, GitHub Actions, etc.) pra bater
// nessa URL 1x/dia às 00:10 horário Brasília.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // ── Auth ──
  const expected = Deno.env.get('SCHEDULED_JOB_TOKEN') ?? ''
  const authHeader = req.headers.get('authorization') || ''
  const got = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (expected && got !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const hoje = new Date().toISOString().slice(0, 10)

  // ── 1. Parcelas vencidas ainda Pendentes ──
  const { data: vencidas, error: errVenc } = await supabase
    .from('parcelas')
    .select('id, financeiro_id, financeiro:financeiro_id(cliente_id)')
    .eq('status', 'Pendente')
    .not('vencimento', 'is', null)
    .lt('vencimento', hoje)

  if (errVenc) {
    return new Response(JSON.stringify({ error: errVenc.message }), { status: 500 })
  }

  const ids = (vencidas ?? []).map((p: any) => p.id)
  if (!ids.length) {
    return new Response(JSON.stringify({ ok: true, marcadas: 0, clientesAfetados: 0 }), { status: 200 })
  }

  // ── 2. Atualiza em lote ──
  const { error: errUpd } = await supabase
    .from('parcelas')
    .update({ status: 'Atrasado', updated_at: new Date().toISOString() })
    .in('id', ids)

  if (errUpd) {
    return new Response(JSON.stringify({ error: errUpd.message }), { status: 500 })
  }

  // ── 3. Sync status dos clientes afetados ──
  const clienteIds: Set<string> = new Set()
  for (const p of vencidas ?? []) {
    const cid = (p as any)?.financeiro?.cliente_id
    if (cid) clienteIds.add(cid)
  }

  let atualizados = 0
  for (const cid of clienteIds) {
    const { data: cliente } = await supabase.from('clientes').select('status').eq('id', cid).maybeSingle()
    if (!cliente) continue
    if (cliente.status !== 'Inadimplente') {
      await supabase.from('clientes').update({ status: 'Inadimplente' }).eq('id', cid)
      atualizados++
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    marcadas: ids.length,
    clientesAfetados: clienteIds.size,
    clientesAtualizados: atualizados,
    dataReferencia: hoje,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
