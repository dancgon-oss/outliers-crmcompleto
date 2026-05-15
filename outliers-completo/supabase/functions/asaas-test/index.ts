import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (_req) => {
  const env = Deno.env.get('ASAAS_ENV')
  const key = Deno.env.get('ASAAS_API_KEY') || ''
  const base = env === 'producao' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3'

  try {
    const customersResp = await fetch(`${base}/customers?limit=1`, { headers: { access_token: key } })
    const customersData = await customersResp.json()
    const customer = customersData?.data?.[0]
    if (!customer) return new Response(JSON.stringify({ step: 'list', data: customersData }), { status: 500 })

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
    const payResp = await fetch(`${base}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: key },
      body: JSON.stringify({
        customer: customer.id,
        billingType: 'UNDEFINED',
        value: 100.00,
        dueDate: tomorrow,
        description: 'TESTE - apagar',
      }),
    })
    const payData = await payResp.json()

    // Se criou, exclui pra não poluir
    if (payData?.id) {
      await fetch(`${base}/payments/${payData.id}`, { method: 'DELETE', headers: { access_token: key } })
    }

    return new Response(JSON.stringify({
      env_value: env,
      payment_status: payResp.status,
      payment_id: payData?.id,
      invoice_url: payData?.invoiceUrl,
      errors: payData?.errors,
    }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
