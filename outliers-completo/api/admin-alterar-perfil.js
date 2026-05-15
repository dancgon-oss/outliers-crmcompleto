// Outliers CRM - admin altera o role de outro usuario (bypass RLS)
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
    var callerId = ures.data.user.id
    var p = await admin.from('profiles').select('role').eq('id', callerId).single()
    if (p.error) return res.status(403).json({ error: 'Falha ao ler perfil: ' + p.error.message })
    if (!p.data || p.data.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' })

    var body = req.body || {}
    var userId = body.userId
    var role = body.role
    var allowed = ['admin','comercial','financeiro','operacional','storydoing','solicitante']
    if (!userId || !role) return res.status(400).json({ error: 'userId e role sao obrigatorios.' })
    if (allowed.indexOf(role) === -1) return res.status(400).json({ error: 'Perfil invalido.' })
    if (userId === callerId) return res.status(400).json({ error: 'Voce nao pode alterar o proprio perfil.' })

    var u = await admin.from('profiles').update({ role: role }).eq('id', userId)
    if (u.error) return res.status(400).json({ error: u.error.message })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
