// Outliers CRM - admin/staff exclui participantes (bypass RLS via service role)
// Body: { ids: [...] } OU { evento_id: 'xxx', todos: true }
import { createClient } from '@supabase/supabase-js'

function sanitize(s) {
  if (!s) return s
  var out = ''
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c >= 33 && c <= 126) out += s.charAt(i)
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  var url = sanitize(process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL)
  var serviceKey = sanitize(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)
  if (!url || !serviceKey) return res.status(500).json({ error: 'Servidor sem SUPABASE_URL ou SUPABASE_SERVICE_KEY configurada.' })

  try {
    var token = sanitize((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
    if (!token) return res.status(401).json({ error: 'Sem token.' })

    var admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    var ures = await admin.auth.getUser(token)
    if (ures.error || !ures.data || !ures.data.user) {
      return res.status(401).json({ error: 'Token invalido: ' + (ures.error ? ures.error.message : 'usuario nao encontrado') })
    }
    var p = await admin.from('profiles').select('role').eq('id', ures.data.user.id).single()
    if (p.error) return res.status(403).json({ error: 'Falha ao ler perfil: ' + p.error.message })
    var role = p.data && p.data.role
    if (!role || (role !== 'admin' && role !== 'comercial')) {
      return res.status(403).json({ error: 'Apenas admin ou comercial podem excluir participantes.' })
    }

    var body = req.body || {}
    var ids = Array.isArray(body.ids) ? body.ids : null
    var evento_id = body.evento_id
    var todos = !!body.todos

    if (todos && evento_id) {
      var lista = await admin.from('participantes').select('id').eq('evento_id', evento_id)
      if (lista.error) return res.status(500).json({ error: lista.error.message })
      ids = (lista.data || []).map(function(r){ return r.id })
    }

    if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhum participante informado para excluir.' })

    // 1) apaga contratos vinculados (FK sem cascade)
    await admin.from('contratos').delete().in('participante_id', ids)
    // 2) checkin_dias e qrs ja tem ON DELETE CASCADE; mas garantimos
    await admin.from('checkin_dias').delete().in('participante_id', ids)
    // 3) apaga participantes
    var d = await admin.from('participantes').delete().in('id', ids)
    if (d.error) return res.status(400).json({ error: d.error.message })

    return res.status(200).json({ ok: true, excluidos: ids.length })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
