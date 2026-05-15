import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

var ROLE_OPTIONS = [
  { value: 'admin',       label: 'Administrador' },
  { value: 'comercial',   label: 'Comercial' },
  { value: 'financeiro',  label: 'Financeiro' },
  { value: 'operacional', label: 'Operacional' },
  { value: 'storydoing',  label: 'Storydoing (acesso restrito a Comissão)' },
  { value: 'solicitante', label: 'Solicitante (envia pedidos ao time)' },
]

var ROLE_COLORS = {
  admin:       '#c9a96e',
  comercial:   '#a78bfa',
  financeiro:  '#34d399',
  operacional: '#60a5fa',
  storydoing:  '#f472b6',
  solicitante: '#fb923c',
}

function Card(props) {
  return (
    <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:10, padding:20, marginBottom:16 }}>
      <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>{props.title}</div>
      {props.children}
    </div>
  )
}

function Field(props) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>{props.label}</label>
      {props.children}
    </div>
  )
}

var inputStyle = {
  width:'100%', background:'#0a0900', border:'1px solid #2a2415', borderRadius:6,
  padding:'10px 12px', color:'#f0ead8', fontSize:13, fontFamily:'Inter,sans-serif', outline:'none',
}
var btnStyle = {
  background:'#c9a96e', border:'none', borderRadius:6, padding:'10px 18px', color:'#0a0900',
  fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif',
}
var btnGhost = { ...btnStyle, background:'#1c1810', color:'#c9a96e', border:'1px solid #2a2415' }

export default function UsuariosPage() {
  var auth = useAuth()
  var isAdmin = auth.isAdmin

  // ---------- TROCAR PRÓPRIA SENHA ----------
  var [pw, setPw] = useState('')
  var [pw2, setPw2] = useState('')
  var [pwLoading, setPwLoading] = useState(false)
  var [pwMsg, setPwMsg] = useState(null)

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwMsg(null)
    if (!pw || pw.length < 6) { setPwMsg({ type:'err', text:'A senha precisa ter no mínimo 6 caracteres.' }); return }
    if (pw !== pw2) { setPwMsg({ type:'err', text:'As senhas não coincidem.' }); return }
    setPwLoading(true)
    var r = await supabase.auth.updateUser({ password: pw })
    setPwLoading(false)
    if (r.error) { setPwMsg({ type:'err', text: r.error.message || 'Erro ao atualizar senha.' }); return }
    setPw(''); setPw2('')
    setPwMsg({ type:'ok', text:'Senha atualizada com sucesso!' })
  }

  // ---------- LISTAR USUÁRIOS (admin) ----------
  var [users, setUsers] = useState([])
  var [loadingUsers, setLoadingUsers] = useState(false)

  async function loadUsers() {
    if (!isAdmin) return
    setLoadingUsers(true)
    try {
      var session = (await supabase.auth.getSession()).data.session
      var token = session ? session.access_token : null
      var resp = await fetch('/api/listar-usuarios', {
        method:'GET',
        headers:{ Authorization: 'Bearer ' + token },
      })
      var data = await resp.json().catch(function(){ return {} })
      if (resp.ok) setUsers(data.users || [])
      else setUsers([])
    } catch (_e) {
      setUsers([])
    }
    setLoadingUsers(false)
  }
  useEffect(function() { loadUsers() }, [isAdmin])

  // ---------- CADASTRAR NOVO USUÁRIO (admin) ----------
  var [newNome, setNewNome] = useState('')
  var [newEmail, setNewEmail] = useState('')
  var [newPw, setNewPw] = useState('')
  var [newRole, setNewRole] = useState('operacional')
  var [creating, setCreating] = useState(false)
  var [createMsg, setCreateMsg] = useState(null)

  async function handleCreateUser(e) {
    e.preventDefault()
    setCreateMsg(null)
    if (!newNome.trim() || !newEmail.trim() || !newPw || newPw.length < 6) {
      setCreateMsg({ type:'err', text:'Preencha nome, e-mail e senha (mínimo 6 caracteres).' }); return
    }
    setCreating(true)
    try {
      var session = (await supabase.auth.getSession()).data.session
      var token = session ? session.access_token : null
      var resp = await fetch('/api/criar-usuario', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ nome:newNome.trim(), email:newEmail.trim().toLowerCase(), password:newPw, role:newRole }),
      })
      var data = await resp.json().catch(function(){ return {} })
      if (!resp.ok) { setCreateMsg({ type:'err', text: data.error || 'Erro ao cadastrar usuário.' }); setCreating(false); return }
      setCreateMsg({ type:'ok', text:'Usuário cadastrado com sucesso!' })
      setNewNome(''); setNewEmail(''); setNewPw(''); setNewRole('operacional')
      loadUsers()
    } catch (err) {
      setCreateMsg({ type:'err', text: err.message || 'Erro de rede.' })
    }
    setCreating(false)
  }

  // ---------- EDITAR NOME / EMAIL / TELEFONE / PIX (admin) ----------
  var [editing, setEditing] = useState(null)
  var [editNome, setEditNome] = useState('')
  var [editEmail, setEditEmail] = useState('')
  var [editTelefone, setEditTelefone] = useState('')
  var [editPix, setEditPix] = useState('')
  var [savingEdit, setSavingEdit] = useState(false)

  function abrirEdicao(u) {
    setEditing(u)
    setEditNome(u.nome || '')
    setEditEmail(u.email || '')
    setEditTelefone(u.telefone || '')
    setEditPix(u.pix || '')
  }

  async function salvarEdicao() {
    if (!editing) return
    var novoNome = editNome.trim()
    var novoEmail = editEmail.trim().toLowerCase()
    var novoTelefone = editTelefone.trim().replace(/\D/g, '')
    var novoPix = editPix.trim()
    if (!novoNome) { alert('Nome obrigatório.'); return }
    if (!novoEmail) { alert('E-mail obrigatório.'); return }
    var mudouNome = novoNome !== (editing.nome || '')
    var mudouEmail = novoEmail !== (editing.email || '')
    var mudouTel = novoTelefone !== (editing.telefone || '')
    var mudouPix = novoPix !== (editing.pix || '')
    if (!mudouNome && !mudouEmail && !mudouTel && !mudouPix) { setEditing(null); return }
    setSavingEdit(true)
    var session = (await supabase.auth.getSession()).data.session
    var token = session ? session.access_token : null
    var body = { userId: editing.id }
    if (mudouNome) body.nome = novoNome
    if (mudouEmail) body.email = novoEmail
    if (mudouTel) body.telefone = novoTelefone
    if (mudouPix) body.pix = novoPix
    var resp = await fetch('/api/admin-editar-usuario', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    })
    var data = await resp.json().catch(function(){ return {} })
    setSavingEdit(false)
    if (!resp.ok) { alert('Erro ao salvar: ' + (data.error || resp.status)); return }
    setEditing(null)
    loadUsers()
  }

  // ---------- ALTERAR ROLE / RESETAR SENHA / EXCLUIR (admin) ----------
  async function handleChangeRole(userId, role) {
    if (!isAdmin) return
    var session = (await supabase.auth.getSession()).data.session
    var token = session ? session.access_token : null
    var resp = await fetch('/api/admin-alterar-perfil', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ userId: userId, role: role }),
    })
    var data = await resp.json().catch(function(){ return {} })
    if (!resp.ok) { alert('Erro ao alterar perfil: ' + (data.error || resp.status)); return }
    loadUsers()
  }

  async function handleSendResetEmail(email) {
    if (!email) return
    var redirect = window.location.origin
    var r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect })
    if (r.error) alert('Erro ao enviar e-mail de reset: ' + r.error.message)
    else alert('E-mail de redefinição enviado para ' + email)
  }

  async function handleAdminResetPassword(userId, email) {
    var novaSenha = window.prompt('Nova senha para ' + email + ' (mínimo 6 caracteres):')
    if (!novaSenha) return
    if (novaSenha.length < 6) { alert('A senha precisa ter no mínimo 6 caracteres.'); return }
    var session = (await supabase.auth.getSession()).data.session
    var token = session ? session.access_token : null
    var resp = await fetch('/api/admin-resetar-senha', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ userId: userId, password: novaSenha }),
    })
    var data = await resp.json().catch(function(){ return {} })
    if (!resp.ok) { alert(data.error || 'Erro ao resetar senha.'); return }
    alert('Senha de ' + email + ' redefinida com sucesso.')
  }

  async function handleDeleteUser(userId, email) {
    if (!window.confirm('Excluir o usuário ' + email + '? Esta ação não pode ser desfeita.')) return
    var session = (await supabase.auth.getSession()).data.session
    var token = session ? session.access_token : null
    var resp = await fetch('/api/excluir-usuario', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ userId: userId }),
    })
    var data = await resp.json().catch(function(){ return {} })
    if (!resp.ok) { alert(data.error || 'Erro ao excluir usuário.'); return }
    loadUsers()
  }

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%' }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:700, color:'#f0ead8' }}>Usuários & Acessos</div>
        <div style={{ fontSize:12, color:'#7a6a4a', marginTop:4 }}>Gerencie sua conta{isAdmin ? ' e os acessos da equipe' : ''}.</div>
      </div>

      {/* MINHA CONTA — TODOS */}
      <Card title="Minha conta">
        <div style={{ display:'flex', gap:16, marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 220px' }}>
            <div style={{ fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em' }}>Nome</div>
            <div style={{ fontSize:14, color:'#f0ead8', marginTop:2 }}>{auth.profile && auth.profile.nome}</div>
          </div>
          <div style={{ flex:'1 1 220px' }}>
            <div style={{ fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em' }}>E-mail</div>
            <div style={{ fontSize:14, color:'#f0ead8', marginTop:2 }}>{auth.profile && auth.profile.email}</div>
          </div>
          <div style={{ flex:'1 1 220px' }}>
            <div style={{ fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em' }}>Perfil</div>
            <div style={{ fontSize:14, color: ROLE_COLORS[auth.role] || '#f0ead8', marginTop:2, textTransform:'uppercase', fontWeight:600 }}>{auth.role}</div>
          </div>
        </div>

        <div style={{ borderTop:'1px solid #1c1810', paddingTop:16 }}>
          <div style={{ fontSize:13, color:'#f0ead8', fontWeight:600, marginBottom:12 }}>Trocar senha</div>
          <form onSubmit={handleChangePassword} style={{ maxWidth:420 }}>
            <Field label="Nova senha (mínimo 6 caracteres)">
              <input type="password" style={inputStyle} value={pw} onChange={function(e){setPw(e.target.value)}} minLength={6} required />
            </Field>
            <Field label="Confirme a nova senha">
              <input type="password" style={inputStyle} value={pw2} onChange={function(e){setPw2(e.target.value)}} minLength={6} required />
            </Field>
            {pwMsg && <div style={{ fontSize:12, marginBottom:10, color: pwMsg.type === 'ok' ? '#34d399' : '#f87171' }}>{pwMsg.text}</div>}
            <button type="submit" style={btnStyle} disabled={pwLoading}>{pwLoading ? 'Salvando…' : 'Salvar nova senha'}</button>
          </form>
        </div>
      </Card>

      {/* CADASTRAR NOVO — ADMIN */}
      {isAdmin && (
        <Card title="Cadastrar novo acesso">
          <form onSubmit={handleCreateUser} style={{ maxWidth:680 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Nome completo">
                <input style={inputStyle} value={newNome} onChange={function(e){setNewNome(e.target.value)}} required />
              </Field>
              <Field label="E-mail">
                <input type="email" style={inputStyle} value={newEmail} onChange={function(e){setNewEmail(e.target.value)}} required />
              </Field>
              <Field label="Senha inicial (mínimo 6 caracteres)">
                <input type="text" style={inputStyle} value={newPw} onChange={function(e){setNewPw(e.target.value)}} minLength={6} required />
              </Field>
              <Field label="Perfil">
                <select style={inputStyle} value={newRole} onChange={function(e){setNewRole(e.target.value)}}>
                  {ROLE_OPTIONS.map(function(o){ return <option key={o.value} value={o.value}>{o.label}</option> })}
                </select>
              </Field>
            </div>
            {createMsg && <div style={{ fontSize:12, marginBottom:10, color: createMsg.type === 'ok' ? '#34d399' : '#f87171' }}>{createMsg.text}</div>}
            <button type="submit" style={btnStyle} disabled={creating}>{creating ? 'Cadastrando…' : 'Cadastrar usuário'}</button>
          </form>
        </Card>
      )}

      {/* MODAL DE EDIÇÃO */}
      {editing && (
        <div onClick={function(){ if(!savingEdit) setEditing(null) }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:12, padding:24, width:460, maxWidth:'92vw' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em' }}>Editar usuário</div>
              <button onClick={function(){ if(!savingEdit) setEditing(null) }} style={{ background:'none', border:'none', color:'#7a6a4a', fontSize:20, cursor:'pointer' }}>×</button>
            </div>
            <Field label="Nome">
              <input style={inputStyle} value={editNome} onChange={function(e){ setEditNome(e.target.value) }} />
            </Field>
            <Field label="E-mail">
              <input type="email" style={inputStyle} value={editEmail} onChange={function(e){ setEditEmail(e.target.value) }} />
            </Field>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Telefone (WhatsApp)">
                <input style={inputStyle} value={editTelefone} onChange={function(e){ setEditTelefone(e.target.value) }} placeholder="(11) 99999-9999" />
              </Field>
              <Field label="Chave PIX (para receber comissões)">
                <input style={inputStyle} value={editPix} onChange={function(e){ setEditPix(e.target.value) }} placeholder="CPF, e-mail, telefone ou aleatória" />
              </Field>
            </div>
            <div style={{ fontSize:11, color:'#7a6a4a', marginBottom:14 }}>
              Para alterar o perfil, use o dropdown na lista. Para alterar a senha, use "Definir senha".
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button style={btnGhost} onClick={function(){ setEditing(null) }} disabled={savingEdit}>Cancelar</button>
              <button style={btnStyle} onClick={salvarEdicao} disabled={savingEdit}>{savingEdit ? 'Salvando…' : 'Salvar alterações'}</button>
            </div>
          </div>
        </div>
      )}

      {/* LISTA — ADMIN */}
      {isAdmin && (
        <Card title={'Usuários cadastrados (' + users.length + ')'}>
          {loadingUsers && <div style={{ color:'#7a6a4a', fontSize:13 }}>Carregando…</div>}
          {!loadingUsers && users.length === 0 && <div style={{ color:'#7a6a4a', fontSize:13 }}>Nenhum usuário encontrado.</div>}
          {!loadingUsers && users.length > 0 && (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ textAlign:'left', color:'#7a6a4a', textTransform:'uppercase', fontSize:10, letterSpacing:'.08em' }}>
                    <th style={{ padding:'10px 12px', borderBottom:'1px solid #1c1810' }}>Nome</th>
                    <th style={{ padding:'10px 12px', borderBottom:'1px solid #1c1810' }}>E-mail</th>
                    <th style={{ padding:'10px 12px', borderBottom:'1px solid #1c1810' }}>Perfil</th>
                    <th style={{ padding:'10px 12px', borderBottom:'1px solid #1c1810', textAlign:'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(function(u) {
                    return (
                      <tr key={u.id} style={{ borderBottom:'1px solid #1c1810' }}>
                        <td style={{ padding:'10px 12px', color:'#f0ead8' }}>{u.nome}</td>
                        <td style={{ padding:'10px 12px', color:'#f0ead8' }}>{u.email}</td>
                        <td style={{ padding:'10px 12px' }}>
                          <select
                            value={u.role || 'operacional'}
                            onChange={function(e){ handleChangeRole(u.id, e.target.value) }}
                            disabled={u.id === (auth.profile && auth.profile.id)}
                            style={{ ...inputStyle, padding:'6px 8px', fontSize:12, color: ROLE_COLORS[u.role] || '#f0ead8', fontWeight:600 }}
                          >
                            {ROLE_OPTIONS.map(function(o){ return <option key={o.value} value={o.value}>{o.label}</option> })}
                          </select>
                        </td>
                        <td style={{ padding:'10px 12px', textAlign:'right', whiteSpace:'nowrap' }}>
                          <button style={{ ...btnGhost, padding:'6px 10px', fontSize:11, marginRight:6 }}
                                  onClick={function(){ abrirEdicao(u) }}>
                            Editar
                          </button>
                          <button style={{ ...btnGhost, padding:'6px 10px', fontSize:11, marginRight:6 }}
                                  onClick={function(){ handleAdminResetPassword(u.id, u.email) }}>
                            Definir senha
                          </button>
                          <button style={{ ...btnGhost, padding:'6px 10px', fontSize:11, marginRight:6 }}
                                  onClick={function(){ handleSendResetEmail(u.email) }}>
                            Enviar reset
                          </button>
                          {u.id !== (auth.profile && auth.profile.id) && (
                            <button style={{ ...btnGhost, padding:'6px 10px', fontSize:11, color:'#f87171', borderColor:'#7f1d1d' }}
                                    onClick={function(){ handleDeleteUser(u.id, u.email) }}>
                              Excluir
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
