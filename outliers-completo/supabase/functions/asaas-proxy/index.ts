// supabase/functions/asaas-proxy/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ASAAS_BASE = Deno.env.get('ASAAS_ENV') === 'producao'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    )
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: CORS })

    const { method, path, body } = await req.json()
    const res = await fetch(`${ASAAS_BASE}${path}`, {
      method: method ?? 'GET',
      headers: { 'Content-Type': 'application/json', 'access_token': Deno.env.get('ASAAS_API_KEY') ?? '', 'User-Agent': 'OutliersCRM/3.0' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    return new Response(JSON.stringify(data), { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
