// Outliers CRM - cria usuario (auth + profile) usando service role
// Requer envs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_KEY)
import { createClient } from '@supabase/supabase-js'

// Remove TODOS os caracteres nao-imprimiveis ASCII (BOM U+FEFF, zero-width, controles).
// URLs e JWTs do Supabase sao 100% ASCII printable.
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
    var authHeader = req.headers.authorization || ''
    var token = sanitize(authHeader.replace(/^Bearer\s+/i, ''))
    if (!token) return res.status(401).json({ error: 'Sem token de autenticacao.' })

    var admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    var ures = await admin.auth.getUser(token)
    if (ures.error || !ures.data || !ures.data.user) {
      return res.status(401).json({ error: 'Token invalido: ' + (ures.error ? ures.error.message : 'usuario nao encontrado') })
    }
    var callerId = ures.data.user.id

    var p = await admin.from('profiles').select('role').eq('id', callerId).single()
    if (p.error) return res.status(403).json({ error: 'Falha ao ler perfil: ' + p.error.message })
    if (!p.data || p.data.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores podem cadastrar usuarios (perfil atual: ' + (p.data ? p.data.role : 'nenhum') + ').' })

    var body = req.body || {}
    var nome = (body.nome || '').trim()
    var email = (body.email || '').trim().toLowerCase()
    var password = body.password || ''
    var role = body.role || 'operacional'
    var allowed = ['admin','comercial','financeiro','operacional','storydoing','solicitante']

    if (!nome || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha sao obrigatorios.' })
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter no minimo 6 caracteres.' })
    if (allowed.indexOf(role) === -1) return res.status(400).json({ error: 'Perfil invalido.' })

    var created = await admin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { nome: nome, role: role },
    })
    if (created.error) return res.status(400).json({ error: created.error.message })

    var newId = created.data.user.id
    var up = await admin.from('profiles').upsert({ id: newId, nome: nome, email: email, role: role }, { onConflict: 'id' })
    if (up.error) return res.status(400).json({ error: 'Usuario criado, mas falhou ao gravar perfil: ' + up.error.message })

    return res.status(200).json({ ok: true, id: newId })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
