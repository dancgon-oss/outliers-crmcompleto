import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmtDate, C } from '../lib/ui'

// Admin / comercial: CRUD de cursos, módulos e matrículas.
// Alunos não chegam aqui (Shell só mostra se canManageCursos).

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

export default function CursosPage() {
  var auth = useAuth()
  var [cursos, setCursos] = useState([])
  var [selected, setSelected] = useState(null)
  var [modulos, setModulos] = useState([])
  var [matriculas, setMatriculas] = useState([])
  var [loading, setLoading] = useState(true)

  var [tab, setTab] = useState('modulos') // 'modulos' | 'matriculas'

  // modais
  var [showCurso, setShowCurso] = useState(null)        // null | 'novo' | curso (edit)
  var [showModulo, setShowModulo] = useState(null)      // null | 'novo' | modulo (edit)
  var [showMatricula, setShowMatricula] = useState(false)

  var [clientes, setClientes] = useState([])
  var [buscaCliente, setBuscaCliente] = useState('')
  var [matriculaSel, setMatriculaSel] = useState({ cliente_id: '', tipo: 'Incluso', expira_em: '' })

  useEffect(function() { fetchCursos() }, [])

  async function fetchCursos() {
    setLoading(true)
    var { data } = await supabase.from('cursos').select('*').order('ordem').order('nome')
    setCursos(data || [])
    setLoading(false)
  }

  async function selectCurso(c) {
    setSelected(c)
    setTab('modulos')
    await Promise.all([fetchModulos(c.id), fetchMatriculas(c.id)])
  }

  async function fetchModulos(cursoId) {
    var { data } = await supabase.from('modulos').select('*').eq('curso_id', cursoId).order('ordem').order('created_at')
    setModulos(data || [])
  }

  async function fetchMatriculas(cursoId) {
    var { data } = await supabase
      .from('matriculas')
      .select('*, clientes(id,nome,email,telefone,status)')
      .eq('curso_id', cursoId)
      .order('matriculado_em', { ascending: false })
    setMatriculas(data || [])
  }

  async function salvarCurso(curso) {
    var payload = {
      nome: curso.nome,
      slug: curso.slug || slugify(curso.nome),
      descricao: curso.descricao || null,
      capa_url: curso.capa_url || null,
      duracao_horas: curso.duracao_horas ? Number(curso.duracao_horas) : null,
      preco_avulso: curso.preco_avulso ? Number(curso.preco_avulso) : null,
      ordem: curso.ordem ? Number(curso.ordem) : 0,
      ativo: curso.ativo !== false,
    }
    if (curso.id) {
      await supabase.from('cursos').update(payload).eq('id', curso.id)
    } else {
      var r = await supabase.from('cursos').insert(payload).select().single()
      if (r.data && !selected) setSelected(r.data)
    }
    await fetchCursos()
    setShowCurso(null)
  }

  async function excluirCurso(id) {
    if (!window.confirm('Excluir este curso? Todos os módulos e matrículas vinculados também serão removidos.')) return
    await supabase.from('cursos').delete().eq('id', id)
    setSelected(null)
    setModulos([]); setMatriculas([])
    await fetchCursos()
  }

  async function salvarModulo(mod) {
    var payload = {
      curso_id: selected.id,
      nome: mod.nome,
      descricao: mod.descricao || null,
      ordem: mod.ordem ? Number(mod.ordem) : 0,
      video_url: mod.video_url || null,
      duracao_min: mod.duracao_min ? Number(mod.duracao_min) : null,
      material_url: mod.material_url || null,
    }
    if (mod.id) {
      await supabase.from('modulos').update(payload).eq('id', mod.id)
    } else {
      await supabase.from('modulos').insert(payload)
    }
    await fetchModulos(selected.id)
    setShowModulo(null)
  }

  async function excluirModulo(id) {
    if (!window.confirm('Excluir este módulo?')) return
    await supabase.from('modulos').delete().eq('id', id)
    await fetchModulos(selected.id)
  }

  async function abrirMatricular() {
    setMatriculaSel({ cliente_id: '', tipo: 'Incluso', expira_em: '' })
    setBuscaCliente('')
    if (!clientes.length) {
      var { data } = await supabase.from('clientes').select('id,nome,email,telefone,status').order('nome').limit(500)
      setClientes(data || [])
    }
    setShowMatricula(true)
  }

  async function confirmarMatricula() {
    if (!matriculaSel.cliente_id || !selected) return
    var payload = {
      cliente_id: matriculaSel.cliente_id,
      curso_id: selected.id,
      tipo: matriculaSel.tipo,
      status: 'Ativa',
      matriculado_em: new Date().toISOString(),
      expira_em: matriculaSel.expira_em || null,
      criado_por: auth.profile ? auth.profile.id : null,
    }
    var r = await supabase.from('matriculas').insert(payload).select().single()
    if (r.error && r.error.code === '23505') { alert('Este cliente já está matriculado neste curso.'); return }
    if (r.error) { alert('Erro: ' + r.error.message); return }
    await fetchMatriculas(selected.id)
    setShowMatricula(false)
  }

  async function cancelarMatricula(m) {
    if (!window.confirm('Cancelar matrícula de ' + (m.clientes?m.clientes.nome:'') + '?')) return
    await supabase.from('matriculas').update({ status: 'Cancelada' }).eq('id', m.id)
    await fetchMatriculas(selected.id)
  }

  async function reativarMatricula(m) {
    await supabase.from('matriculas').update({ status: 'Ativa' }).eq('id', m.id)
    await fetchMatriculas(selected.id)
  }

  var S = {
    card: { background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10 },
    inp: { background: C.bgHover, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', fontSize: 13, borderRadius: 8, outline: 'none', fontFamily: 'Inter,sans-serif', width: '100%' },
    btnG: { background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '9px 16px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '7px 14px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 12, cursor: 'pointer' },
    btnDanger: { background: 'none', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '6px 12px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 12, cursor: 'pointer' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    modal: { background: '#141209', border: '1px solid ' + C.border2, borderRadius: 14, padding: 26, width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' },
    lbl: { display: 'block', fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 },
  }

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter,sans-serif', background: C.bg }}>

      {/* Sidebar: lista de cursos */}
      <div style={{ width: selected ? 300 : '100%', borderRight: selected ? '1px solid ' + C.border : 'none', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgCard }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Cursos</span>
          <button style={S.btnG} onClick={function(){ setShowCurso({ nome: '', ordem: cursos.length + 1, ativo: true }) }}>+ Novo</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 13 }}>Carregando...</div>}
          {!loading && cursos.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum curso cadastrado.</div>}
          {cursos.map(function(c) {
            var active = selected && selected.id === c.id
            return (
              <div key={c.id} onClick={function(){ selectCurso(c) }}
                style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.border, background: active ? C.bgHover : 'transparent', cursor: 'pointer', transition: 'background .1s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 3 }}>{c.nome}</div>
                    <div style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>{c.slug}</div>
                  </div>
                  {!c.ativo && <span style={{ fontSize: 10, color: C.text3, background: C.bgHover, padding: '2px 8px', borderRadius: 20 }}>inativo</span>}
                </div>
                {c.duracao_horas && <div style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>⏱ {c.duracao_horas}h</div>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Detalhe do curso */}
      {selected && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px 24px', borderBottom: '1px solid ' + C.border, background: C.bgCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{selected.nome}</div>
              <div style={{ fontSize: 12, color: C.text3, marginTop: 3 }}>{selected.descricao || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.btnGhost} onClick={function(){ setShowCurso(selected) }}>Editar</button>
              <button style={S.btnDanger} onClick={function(){ excluirCurso(selected.id) }}>Excluir</button>
              <button style={S.btnGhost} onClick={function(){ setSelected(null) }}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid ' + C.border, background: C.bgCard }}>
            {[['modulos', 'Módulos (' + modulos.length + ')'], ['matriculas', 'Matrículas (' + matriculas.length + ')']].map(function(t) {
              var active = tab === t[0]
              return (
                <button key={t[0]} onClick={function(){ setTab(t[0]) }}
                  style={{ background: 'none', border: 'none', borderBottom: '2px solid ' + (active ? C.gold : 'transparent'), color: active ? C.gold : C.text3, padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: 'Inter,sans-serif' }}>
                  {t[1]}
                </button>
              )
            })}
          </div>

          {/* Conteúdo */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
            {tab === 'modulos' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                  <button style={S.btnG} onClick={function(){ setShowModulo({ nome: '', ordem: modulos.length + 1 }) }}>+ Módulo</button>
                </div>
                {modulos.length === 0
                  ? <div style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum módulo cadastrado.</div>
                  : (
                    <div style={S.card}>
                      {modulos.map(function(m, i, arr) {
                        return (
                          <div key={m.id} style={{ padding: '14px 18px', borderBottom: i < arr.length - 1 ? '1px solid ' + C.border : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ fontSize: 12, color: C.text3, fontFamily: 'monospace', width: 28 }}>{String(m.ordem).padStart(2, '0')}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{m.nome}</div>
                              {m.descricao && <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>{m.descricao}</div>}
                              <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: C.text3 }}>
                                {m.duracao_min && <span>⏱ {m.duracao_min} min</span>}
                                {m.video_url && <span style={{ color: C.gold }}>🎬 vídeo</span>}
                                {m.material_url && <span style={{ color: C.gold }}>📎 material</span>}
                              </div>
                            </div>
                            <button style={S.btnGhost} onClick={function(){ setShowModulo(m) }}>Editar</button>
                            <button style={S.btnDanger} onClick={function(){ excluirModulo(m.id) }}>Excluir</button>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
            )}

            {tab === 'matriculas' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                  <button style={S.btnG} onClick={abrirMatricular}>+ Matricular aluno</button>
                </div>
                {matriculas.length === 0
                  ? <div style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum aluno matriculado.</div>
                  : (
                    <div style={S.card}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 110px 110px 100px', padding: '10px 16px', borderBottom: '1px solid ' + C.border }}>
                        {['Aluno', 'Tipo', 'Matriculado', 'Status', ''].map(function(h, i) { return <span key={i} style={{ fontSize: 10, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span> })}
                      </div>
                      {matriculas.map(function(m, i, arr) {
                        var ativo = m.status === 'Ativa'
                        var cli = m.clientes || {}
                        return (
                          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 110px 110px 100px', padding: '12px 16px', borderBottom: i < arr.length - 1 ? '1px solid ' + C.border : 'none', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{cli.nome || '—'}</div>
                              <div style={{ fontSize: 11, color: C.text3 }}>{cli.email}</div>
                            </div>
                            <div style={{ fontSize: 12, color: C.text2 }}>{m.tipo}</div>
                            <div style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>{fmtDate(m.matriculado_em)}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: ativo ? '#4ade80' : C.text3 }}>{m.status}</div>
                            <div>
                              {ativo
                                ? <button style={S.btnDanger} onClick={function(){ cancelarMatricula(m) }}>Cancelar</button>
                                : <button style={S.btnGhost} onClick={function(){ reativarMatricula(m) }}>Reativar</button>
                              }
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Curso */}
      {showCurso && <CursoModal initial={showCurso === 'novo' ? {} : showCurso} onSave={salvarCurso} onClose={function(){ setShowCurso(null) }} S={S} />}

      {/* MODAL: Módulo */}
      {showModulo && <ModuloModal initial={showModulo} onSave={salvarModulo} onClose={function(){ setShowModulo(null) }} S={S} />}

      {/* MODAL: Matricular */}
      {showMatricula && (
        <div style={S.overlay} onClick={function(){ setShowMatricula(false) }}>
          <div style={S.modal} onClick={function(e){ e.stopPropagation() }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 18 }}>Matricular aluno em "{selected && selected.nome}"</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.lbl}>Buscar cliente</label>
                <input style={S.inp} placeholder="Nome, e-mail ou telefone..." value={buscaCliente} onChange={function(e){ setBuscaCliente(e.target.value) }} />
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', ...S.card, padding: 4 }}>
                {clientes
                  .filter(function(c){
                    var q = buscaCliente.toLowerCase()
                    if (!q) return true
                    return (c.nome || '').toLowerCase().includes(q)
                      || (c.email || '').toLowerCase().includes(q)
                      || (c.telefone || '').includes(buscaCliente)
                  })
                  .slice(0, 50)
                  .map(function(c) {
                    var sel = matriculaSel.cliente_id === c.id
                    return (
                      <div key={c.id} onClick={function(){ setMatriculaSel(function(p){ return { ...p, cliente_id: c.id } }) }}
                        style={{ padding: '9px 12px', borderRadius: 6, cursor: 'pointer', background: sel ? C.bgHover : 'transparent', border: '1px solid ' + (sel ? C.gold : 'transparent'), marginBottom: 3 }}>
                        <div style={{ fontSize: 13, color: C.text, fontWeight: sel ? 600 : 400 }}>{c.nome}</div>
                        <div style={{ fontSize: 11, color: C.text3 }}>{c.email || '—'} · {c.telefone || '—'}</div>
                      </div>
                    )
                  })
                }
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={S.lbl}>Tipo</label>
                  <select style={S.inp} value={matriculaSel.tipo} onChange={function(e){ setMatriculaSel(function(p){ return { ...p, tipo: e.target.value } }) }}>
                    <option>Incluso</option><option>Compra Avulsa</option><option>Bônus</option><option>Cortesia</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={S.lbl}>Expira em (opcional)</label>
                  <input style={S.inp} type="date" value={matriculaSel.expira_em} onChange={function(e){ setMatriculaSel(function(p){ return { ...p, expira_em: e.target.value } }) }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button style={S.btnGhost} onClick={function(){ setShowMatricula(false) }}>Cancelar</button>
              <button style={S.btnG} onClick={confirmarMatricula} disabled={!matriculaSel.cliente_id}>Matricular</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Componentes auxiliares ───────────────────────────────────

function CursoModal({ initial, onSave, onClose, S }) {
  var [c, setC] = useState({
    id: initial.id, nome: initial.nome || '', slug: initial.slug || '',
    descricao: initial.descricao || '', capa_url: initial.capa_url || '',
    duracao_horas: initial.duracao_horas || '', preco_avulso: initial.preco_avulso || '',
    ordem: initial.ordem || 0, ativo: initial.ativo !== false,
  })
  var [saving, setSaving] = useState(false)
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={function(e){ e.stopPropagation() }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f0ead8', marginBottom: 18 }}>{c.id ? 'Editar curso' : 'Novo curso'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={S.lbl}>Nome *</label>
            <input style={S.inp} value={c.nome} onChange={function(e){ setC(function(p){ return { ...p, nome: e.target.value } }) }} />
          </div>
          <div>
            <label style={S.lbl}>Slug (URL-friendly) — deixe em branco pra gerar</label>
            <input style={S.inp} value={c.slug} onChange={function(e){ setC(function(p){ return { ...p, slug: e.target.value } }) }} placeholder="ex: metodo-cash" />
          </div>
          <div>
            <label style={S.lbl}>Descrição</label>
            <textarea rows={3} style={{ ...S.inp, resize: 'vertical', fontFamily: 'Inter,sans-serif' }} value={c.descricao} onChange={function(e){ setC(function(p){ return { ...p, descricao: e.target.value } }) }} />
          </div>
          <div>
            <label style={S.lbl}>URL da capa (imagem)</label>
            <input style={S.inp} value={c.capa_url} onChange={function(e){ setC(function(p){ return { ...p, capa_url: e.target.value } }) }} placeholder="https://..." />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={S.lbl}>Duração (horas)</label>
              <input style={S.inp} type="number" step="0.5" value={c.duracao_horas} onChange={function(e){ setC(function(p){ return { ...p, duracao_horas: e.target.value } }) }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.lbl}>Preço avulso (R$)</label>
              <input style={S.inp} type="number" step="0.01" value={c.preco_avulso} onChange={function(e){ setC(function(p){ return { ...p, preco_avulso: e.target.value } }) }} />
            </div>
            <div style={{ width: 100 }}>
              <label style={S.lbl}>Ordem</label>
              <input style={S.inp} type="number" value={c.ordem} onChange={function(e){ setC(function(p){ return { ...p, ordem: e.target.value } }) }} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#b8a882' }}>
            <input type="checkbox" checked={c.ativo} onChange={function(e){ setC(function(p){ return { ...p, ativo: e.target.checked } }) }} />
            Ativo (visível no catálogo)
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button style={S.btnGhost} onClick={onClose}>Cancelar</button>
          <button style={S.btnG} onClick={async function(){ setSaving(true); await onSave(c); setSaving(false) }} disabled={saving || !c.nome}>{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

function ModuloModal({ initial, onSave, onClose, S }) {
  var [m, setM] = useState({
    id: initial.id, nome: initial.nome || '', descricao: initial.descricao || '',
    ordem: initial.ordem || 0, video_url: initial.video_url || '',
    duracao_min: initial.duracao_min || '', material_url: initial.material_url || '',
  })
  var [saving, setSaving] = useState(false)
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={function(e){ e.stopPropagation() }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f0ead8', marginBottom: 18 }}>{m.id ? 'Editar módulo' : 'Novo módulo'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={S.lbl}>Nome *</label>
              <input style={S.inp} value={m.nome} onChange={function(e){ setM(function(p){ return { ...p, nome: e.target.value } }) }} />
            </div>
            <div style={{ width: 90 }}>
              <label style={S.lbl}>Ordem</label>
              <input style={S.inp} type="number" value={m.ordem} onChange={function(e){ setM(function(p){ return { ...p, ordem: e.target.value } }) }} />
            </div>
          </div>
          <div>
            <label style={S.lbl}>Descrição</label>
            <textarea rows={2} style={{ ...S.inp, resize: 'vertical', fontFamily: 'Inter,sans-serif' }} value={m.descricao} onChange={function(e){ setM(function(p){ return { ...p, descricao: e.target.value } }) }} />
          </div>
          <div>
            <label style={S.lbl}>URL do vídeo (YouTube, Vimeo, link direto)</label>
            <input style={S.inp} value={m.video_url} onChange={function(e){ setM(function(p){ return { ...p, video_url: e.target.value } }) }} placeholder="https://..." />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={S.lbl}>Duração (min)</label>
              <input style={S.inp} type="number" value={m.duracao_min} onChange={function(e){ setM(function(p){ return { ...p, duracao_min: e.target.value } }) }} />
            </div>
            <div style={{ flex: 2 }}>
              <label style={S.lbl}>URL do material (PDF, etc.)</label>
              <input style={S.inp} value={m.material_url} onChange={function(e){ setM(function(p){ return { ...p, material_url: e.target.value } }) }} placeholder="https://..." />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button style={S.btnGhost} onClick={onClose}>Cancelar</button>
          <button style={S.btnG} onClick={async function(){ setSaving(true); await onSave(m); setSaving(false) }} disabled={saving || !m.nome}>{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
