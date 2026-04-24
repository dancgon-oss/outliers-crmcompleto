import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmtDate, C } from '../lib/ui'

// Kanban de leads comerciais.
// Colunas = estágios. Cards = clientes com stage definido. Drag-drop pra mover.
// Ao mover, trigger de DB grava em lead_stage_history automaticamente.

var STAGES = [
  { id: 'Novo',        label: 'Novo',        color: '#60a5fa' },
  { id: 'Em contato',  label: 'Em contato',  color: '#c9a96e' },
  { id: 'Proposta',    label: 'Proposta',    color: '#a78bfa' },
  { id: 'Ganho',       label: 'Ganho',       color: '#4ade80' },
  { id: 'Perdido',     label: 'Perdido',     color: '#f87171' },
]

function relativeTime(iso) {
  if (!iso) return ''
  var d = new Date(iso)
  var diff = Date.now() - d.getTime()
  var min = Math.round(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return min + ' min'
  var h = Math.round(min / 60)
  if (h < 24) return h + 'h'
  var dias = Math.round(h / 24)
  if (dias < 30) return dias + 'd'
  var mes = Math.round(dias / 30)
  return mes + 'mes'
}

export default function PipelinePage() {
  var auth = useAuth()
  var [leads, setLeads] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [filtroResp, setFiltroResp] = useState('todos')
  var [profiles, setProfiles] = useState([])
  var [draggingId, setDraggingId] = useState(null)
  var [dropTarget, setDropTarget] = useState(null)
  var [detalhe, setDetalhe] = useState(null) // cliente selecionado
  var [historico, setHistorico] = useState([])

  useEffect(function() {
    fetchLeads()
    fetchProfiles()
  }, [])

  async function fetchLeads() {
    setLoading(true)
    var { data } = await supabase
      .from('clientes')
      .select('id,nome,email,telefone,cpf,status,origem,programa,stage,responsavel_id,ultimo_contato,observacoes,data_entrada,created_at')
      .not('stage', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500)
    setLeads(data || [])
    setLoading(false)
  }

  async function fetchProfiles() {
    var { data } = await supabase.from('profiles').select('id,nome,role').in('role', ['admin','comercial']).order('nome')
    setProfiles(data || [])
  }

  async function moveStage(clienteId, newStage) {
    // Optimistic: atualiza UI antes do servidor
    setLeads(function(prev){ return prev.map(function(l){ return l.id === clienteId ? { ...l, stage: newStage } : l }) })
    await supabase.from('clientes').update({ stage: newStage, ultimo_contato: new Date().toISOString() }).eq('id', clienteId)
  }

  async function moveManual(clienteId, newStage) {
    await moveStage(clienteId, newStage)
  }

  async function atribuirResponsavel(clienteId, respId) {
    setLeads(function(prev){ return prev.map(function(l){ return l.id === clienteId ? { ...l, responsavel_id: respId || null } : l }) })
    await supabase.from('clientes').update({ responsavel_id: respId || null }).eq('id', clienteId)
  }

  async function abrirDetalhe(lead) {
    setDetalhe(lead)
    var { data } = await supabase
      .from('lead_stage_history')
      .select('*, profiles:movido_por(nome)')
      .eq('cliente_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setHistorico(data || [])
  }

  function dragStart(e, lead) {
    setDraggingId(lead.id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', lead.id) } catch (_e) {}
  }
  function dragOverCol(e, stageId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTarget !== stageId) setDropTarget(stageId)
  }
  function dragLeaveCol(e, stageId) {
    if (dropTarget === stageId) setDropTarget(null)
  }
  async function dropCol(e, stageId) {
    e.preventDefault()
    setDropTarget(null)
    if (!draggingId) return
    var lead = leads.find(function(l){ return l.id === draggingId })
    setDraggingId(null)
    if (!lead || lead.stage === stageId) return
    await moveStage(lead.id, stageId)
  }

  var filtrados = useMemo(function() {
    var q = search.trim().toLowerCase()
    return leads.filter(function(l) {
      if (filtroResp === 'mim' && l.responsavel_id !== (auth.profile && auth.profile.id)) return false
      if (filtroResp === 'sem' && l.responsavel_id) return false
      if (filtroResp !== 'todos' && filtroResp !== 'mim' && filtroResp !== 'sem' && l.responsavel_id !== filtroResp) return false
      if (!q) return true
      return (l.nome || '').toLowerCase().includes(q)
        || (l.email || '').toLowerCase().includes(q)
        || (l.telefone || '').includes(search)
        || (l.programa || '').toLowerCase().includes(q)
    })
  }, [leads, search, filtroResp, auth.profile])

  var porStage = useMemo(function() {
    var m = {}
    STAGES.forEach(function(s){ m[s.id] = [] })
    filtrados.forEach(function(l){ if (m[l.stage]) m[l.stage].push(l) })
    return m
  }, [filtrados])

  var profileMap = useMemo(function() {
    var m = {}
    profiles.forEach(function(p){ m[p.id] = p.nome })
    return m
  }, [profiles])

  var S = {
    bg: { background: C.bg, minHeight: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif' },
    inp: { background: C.bgHover, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', fontSize: 13, borderRadius: 8, outline: 'none', fontFamily: 'Inter,sans-serif' },
    btnG: { background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '8px 16px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '7px 14px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 12, cursor: 'pointer' },
  }

  return (
    <div style={S.bg}>
      {/* Header */}
      <div style={{ padding: '14px 22px', borderBottom: '1px solid ' + C.border, background: C.bgCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Pipeline Comercial</div>
          <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{filtrados.length} lead{filtrados.length !== 1 ? 's' : ''} · {leads.length} no total</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...S.inp, minWidth: 220 }} placeholder="Buscar lead..." value={search} onChange={function(e){ setSearch(e.target.value) }} />
          <select style={{ ...S.inp, minWidth: 160 }} value={filtroResp} onChange={function(e){ setFiltroResp(e.target.value) }}>
            <option value="todos">Todos responsáveis</option>
            <option value="mim">Só meus leads</option>
            <option value="sem">Sem responsável</option>
            <option disabled>──────────</option>
            {profiles.map(function(p){ return <option key={p.id} value={p.id}>{p.nome}</option> })}
          </select>
        </div>
      </div>

      {loading
        ? <div style={{ padding: 50, textAlign: 'center', color: C.text3 }}>Carregando...</div>
        : (
          <div style={{ flex: 1, overflowX: 'auto', padding: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + STAGES.length + ', minmax(260px, 1fr))', gap: 12, minWidth: 1200, height: '100%' }}>
              {STAGES.map(function(st) {
                var items = porStage[st.id] || []
                var isTarget = dropTarget === st.id
                return (
                  <div key={st.id}
                    onDragOver={function(e){ dragOverCol(e, st.id) }}
                    onDragLeave={function(e){ dragLeaveCol(e, st.id) }}
                    onDrop={function(e){ dropCol(e, st.id) }}
                    style={{
                      background: C.bgCard,
                      border: '1px solid ' + (isTarget ? st.color : C.border),
                      borderRadius: 10, display: 'flex', flexDirection: 'column',
                      transition: 'border-color .12s',
                    }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 9999, background: st.color }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, letterSpacing: '.04em' }}>{st.label}</span>
                      </div>
                      <span style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>{items.length}</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {items.length === 0 && (
                        <div style={{ padding: '22px 10px', textAlign: 'center', color: C.text3, fontSize: 11, fontStyle: 'italic' }}>
                          {isTarget ? 'Solte aqui' : 'Vazio'}
                        </div>
                      )}
                      {items.map(function(l) {
                        var resp = l.responsavel_id ? profileMap[l.responsavel_id] : null
                        return (
                          <div key={l.id}
                            draggable
                            onDragStart={function(e){ dragStart(e, l) }}
                            onDragEnd={function(){ setDraggingId(null); setDropTarget(null) }}
                            onClick={function(){ abrirDetalhe(l) }}
                            style={{
                              background: C.bgHover, border: '1px solid ' + C.border, borderRadius: 8,
                              padding: '10px 12px', cursor: 'grab', userSelect: 'none',
                              opacity: draggingId === l.id ? 0.4 : 1,
                              transition: 'opacity .15s, border-color .15s',
                            }}
                            onMouseEnter={function(e){ e.currentTarget.style.borderColor = st.color }}
                            onMouseLeave={function(e){ e.currentTarget.style.borderColor = C.border }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{l.nome}</div>
                            <div style={{ fontSize: 11, color: C.text3, marginBottom: 6, fontFamily: 'monospace' }}>{l.telefone || l.email || '—'}</div>
                            {l.programa && <div style={{ fontSize: 10, color: st.color, marginBottom: 6, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 600 }}>{l.programa}</div>}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: C.text3 }}>
                              <span>{resp || 'Sem dono'}</span>
                              <span title={'Criado em ' + fmtDate(l.created_at)}>{relativeTime(l.created_at)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      {/* Detalhe lead */}
      {detalhe && (
        <div onClick={function(){ setDetalhe(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={function(e){ e.stopPropagation() }}
            style={{ background: '#141209', border: '1px solid ' + C.border2, borderRadius: 14, padding: 0, width: 600, maxWidth: '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{detalhe.nome}</div>
                <div style={{ fontSize: 12, color: C.text3, marginTop: 4, fontFamily: 'monospace' }}>{detalhe.telefone || '—'} · {detalhe.email || '—'}</div>
              </div>
              <button style={S.btnGhost} onClick={function(){ setDetalhe(null) }}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
              {/* Ações rápidas */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={{ display: 'block', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 }}>Estágio</label>
                  <select style={{ ...S.inp, width: '100%' }} value={detalhe.stage || ''}
                    onChange={async function(e){ await moveManual(detalhe.id, e.target.value); setDetalhe(function(d){ return { ...d, stage: e.target.value } }) }}>
                    {STAGES.map(function(s){ return <option key={s.id} value={s.id}>{s.label}</option> })}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={{ display: 'block', fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 }}>Responsável</label>
                  <select style={{ ...S.inp, width: '100%' }} value={detalhe.responsavel_id || ''}
                    onChange={async function(e){ await atribuirResponsavel(detalhe.id, e.target.value); setDetalhe(function(d){ return { ...d, responsavel_id: e.target.value || null } }) }}>
                    <option value="">Sem responsável</option>
                    {profiles.map(function(p){ return <option key={p.id} value={p.id}>{p.nome}</option> })}
                  </select>
                </div>
                {detalhe.telefone && (
                  <a href={'https://wa.me/' + (function(){ var t = detalhe.telefone.replace(/\D/g,''); return t.length === 11 ? '55' + t : t })()}
                    target="_blank" rel="noreferrer"
                    style={{ alignSelf: 'flex-end', background: '#14532d22', border: '1px solid #14532d', color: '#4ade80', padding: '9px 14px', borderRadius: 8, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>
                    📱 WhatsApp
                  </a>
                )}
              </div>

              {/* Info */}
              <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 12 }}>
                  <div><div style={{ color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, marginBottom: 3 }}>Origem</div><div style={{ color: C.text }}>{detalhe.origem || '—'}</div></div>
                  <div><div style={{ color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, marginBottom: 3 }}>Programa</div><div style={{ color: C.text }}>{detalhe.programa || '—'}</div></div>
                  <div><div style={{ color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, marginBottom: 3 }}>Entrada</div><div style={{ color: C.text, fontFamily: 'monospace' }}>{fmtDate(detalhe.data_entrada)}</div></div>
                  <div><div style={{ color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, marginBottom: 3 }}>Último contato</div><div style={{ color: C.text, fontFamily: 'monospace' }}>{detalhe.ultimo_contato ? fmtDate(detalhe.ultimo_contato) : '—'}</div></div>
                </div>
                {detalhe.observacoes && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + C.border }}>
                    <div style={{ color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, marginBottom: 4 }}>Observações</div>
                    <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{detalhe.observacoes}</div>
                  </div>
                )}
              </div>

              {/* Histórico de movimentações */}
              <div>
                <div style={{ fontSize: 11, color: C.gold, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10, fontWeight: 600 }}>Histórico no funil</div>
                {historico.length === 0
                  ? <div style={{ fontSize: 12, color: C.text3, fontStyle: 'italic' }}>Nenhuma movimentação registrada.</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {historico.map(function(h) {
                        return (
                          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '8px 12px', background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 6 }}>
                            <span style={{ fontFamily: 'monospace', color: C.text3, width: 70 }}>{fmtDate(h.created_at)}</span>
                            <span style={{ color: C.text2 }}>{h.stage_from || '—'} → <b style={{ color: C.gold }}>{h.stage_to}</b></span>
                            <span style={{ flex: 1 }} />
                            <span style={{ fontSize: 11, color: C.text3 }}>{(h.profiles && h.profiles.nome) || 'Sistema'}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
