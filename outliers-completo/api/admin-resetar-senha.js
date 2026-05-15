// Outliers CRM - admin redefine senha de outro usuario
// Requer envs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_KEY)
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
    if (!p.data || p.data.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores (perfil atual: ' + (p.data ? p.data.role : 'nenhum') + ').' })

    var body = req.body || {}
    var userId = body.userId
    var password = body.password
    if (!userId || !password) return res.status(400).json({ error: 'userId e password sao obrigatorios.' })
    if (password.length < 6) return res.status(400).json({ error: 'Senha precisa ter no minimo 6 caracteres.' })

    var u = await admin.auth.admin.updateUserById(userId, { password: password })
    if (u.error) return res.status(400).json({ error: u.error.message })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
