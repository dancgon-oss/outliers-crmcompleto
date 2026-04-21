import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, C, INPUT_S, BTN_PRIMARY, BTN_GHOST, LABEL_S, CARD_S, OVERLAY_S, MODAL_S, EVENTO_STATUS_C } from '../lib/ui'

var MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
var EMPTY_EV = { nome:'', tipo:'Paradigma', data_inicio:'', data_fim:'', local:'', descricao:'', status:'Planejado', capacidade:'', preco_ingresso:'', observacoes:'' }
var EMPTY_PART = { nome:'', email:'', telefone:'', cpf:'' }

export default function EventosPage() {
  var auth = useAuth()
  var [eventos, setEventos] = useState([])
  var [selected, setSelected] = useState(null)
  var [participantes, setParticipantes] = useState([])
  var [checkinsDia, setCheckinsDia] = useState([])
  var [loading, setLoading] = useState(true)
  var [tab, setTab] = useState('participantes')
  var [anoFiltro, setAnoFiltro] = useState(new Date().getFullYear())
  var [modalEv, setModalEv] = useState(null)
  var [formEv, setFormEv] = useState(EMPTY_EV)
  var [modalPart, setModalPart] = useState(false)
  var [formPart, setFormPart] = useState(EMPTY_PART)
  var [saving, setSaving] = useState(false)
  var [erro, setErro] = useState('')
  var [search, setSearch] = useState('')
  var [modalQR, setModalQR] = useState(null)
  var [qrLoading, setQrLoading] = useState(false)

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var { data } = await supabase.from('eventos').select('*').order('data_inicio', { ascending: false })
    setEventos(data || [])
    setLoading(false)
  }

  async function selecionarEvento(ev) {
    setSelected(ev)
    setTab('participantes')
    setSearch('')
    var [rp, rcd] = await Promise.all([
      supabase.from('participantes').select('*').eq('evento_id', ev.id).order('nome'),
      supabase.from('checkin_dias').select('participante_id,dia').eq('evento_id', ev.id)
    ])
    setParticipantes(rp.data || [])
    setCheckinsDia(rcd.data || [])
  }

  async function salvarEvento() {
    if (!formEv.nome.trim() || !formEv.data_inicio) { setErro('Nome e data sao obrigatorios.'); return }
    setSaving(true); setErro('')
    var payload = { nome: formEv.nome.trim(), tipo: formEv.tipo, data_inicio: formEv.data_inicio, data_fim: formEv.data_fim || null, local: formEv.local || null, descricao: formEv.descricao || null, status: formEv.status, capacidade: formEv.capacidade ? Number(formEv.capacidade) : null, preco_ingresso: formEv.preco_ingresso ? Number(formEv.preco_ingresso) : null, observacoes: formEv.observacoes || null }
    if (modalEv === 'novo') {
      var r = await supabase.from('eventos').insert({ ...payload, criado_por: auth.profile ? auth.profile.id : null })
      if (r.error) { setErro(r.error.message); setSaving(false); return }
    } else {
      var r2 = await supabase.from('eventos').update(payload).eq('id', modalEv.id)
      if (r2.error) { setErro(r2.error.message); setSaving(false); return }
      if (selected && selected.id === modalEv.id) setSelected({ ...selected, ...payload })
    }
    setSaving(false); setModalEv(null); carregar()
  }

  async function adicionarParticipante() {
    if (!formPart.nome.trim() || !formPart.telefone.trim()) { setErro('Nome e telefone sao obrigatorios.'); return }
    if (!selected) return
    setSaving(true); setErro('')
    var r = await supabase.from('participantes').insert({ evento_id: selected.id, nome: formPart.nome.trim(), email: formPart.email || null, telefone: formPart.telefone.trim(), cpf: formPart.cpf || null })
    if (r.error) { setErro(r.error.message); setSaving(false); return }
    setSaving(false); setModalPart(false); setFormPart(EMPTY_PART)
    selecionarEvento(selected)
  }

  async function aprovarEnviarQR(part) {
    setQrLoading(true)
    await supabase.from('participantes').update({ qr_aprovado: true, qr_aprovado_por: auth.profile ? auth.profile.id : null, qr_aprovado_at: new Date().toISOString() }).eq('id', part.id)
    setQrLoading(false)
    setModalQR(null)
    selecionarEvento(selected)
  }

  async function aprovarTodos() {
    if (!selected) return
    var ids = participantes.filter(function(p) { return !p.qr_aprovado }).map(function(p) { return p.id })
    if (ids.length === 0) return
    for (var i = 0; i < ids.length; i++) {
      await supabase.from('participantes').update({ qr_aprovado: true, qr_aprovado_por: auth.profile ? auth.profile.id : null, qr_aprovado_at: new Date().toISOString() }).eq('id', ids[i])
    }
    selecionarEvento(selected)
  }

  async function deletarParticipante(id) {
    await supabase.from('participantes').delete().eq('id', id)
    selecionarEvento(selected)
  }

  async function updateStatus(evId, status) {
    await supabase.from('eventos').update({ status: status }).eq('id', evId)
    if (selected && selected.id === evId) setSelected({ ...selected, status: status })
    carregar()
  }

  function getQRUrl(token) {
    return window.location.origin + '/checkin/' + token
  }

  function copiarQR(token) {
    navigator.clipboard.writeText(getQRUrl(token))
  }

  function abrirWhatsApp(part) {
    var tel = part.telefone ? part.telefone.replace(/\D/g, '') : ''
    if (tel.length === 11) tel = '55' + tel
    var msg = 'Ola ' + part.nome + '! Aqui esta seu QR Code para o check-in da Imersao Paradigma. Acesse: ' + getQRUrl(part.qr_token)
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank')
  }

  var anoAtual = new Date().getFullYear()
  var anos = Array.from({ length: 5 }, function(_, i) { return anoAtual - 1 + i })

  var eventosFiltrados = eventos.filter(function(ev) {
    var d = new Date(ev.data_inicio + 'T00:00:00')
    return d.getFullYear() === anoFiltro
  })

  var eventosCalendario = {}
  eventosFiltrados.forEach(function(ev) {
    var m = new Date(ev.data_inicio + 'T00:00:00').getMonth()
    if (!eventosCalendario[m]) eventosCalendario[m] = []
    eventosCalendario[m].push(ev)
  })

  var partsFiltrados = participantes.filter(function(p) {
    return !search || p.nome.toLowerCase().includes(search.toLowerCase()) || (p.telefone || '').includes(search)
  })

  var checkinMap = {}
  checkinsDia.forEach(function(c) {
    if (!checkinMap[c.participante_id]) checkinMap[c.participante_id] = []
    checkinMap[c.participante_id].push(c.dia)
  })

  var statsEv = selected ? {
    total: participantes.length,
    presentes: participantes.filter(function(p) { return p.checkin_at }).length,
    compraram: participantes.filter(function(p) { return p.comprou }).length,
    aprovados: participantes.filter(function(p) { return p.qr_aprovado }).length,
    dia1: checkinsDia.filter(function(c) { return c.dia === 1 }).length,
    dia2: checkinsDia.filter(function(c) { return c.dia === 2 }).length,
    dia3: checkinsDia.filter(function(c) { return c.dia === 3 }).length,
  } : {}

  var S = { inp: INPUT_S, btnG: BTN_PRIMARY, btnGhost: BTN_GHOST, lbl: LABEL_S, card: CARD_S, overlay: OVERLAY_S, modal: MODAL_S }
  var canManage = auth.canManageEventos

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, fontFamily: 'Inter,sans-serif' }}>

      {/* PAINEL ESQUERDO: calendario + lista */}
      <div style={{ width: selected ? 340 : '100%', minWidth: selected ? 340 : 'auto', borderRight: selected ? '1px solid ' + C.border : 'none', display: 'flex', flexDirection: 'column', background: '#0d0b06', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Eventos</div>
            <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>{eventos.length} cadastrados</div>
          </div>
          {canManage && <button style={{ ...S.btnG, padding: '9px 14px', fontSize: 14 }} onClick={function() { setFormEv(EMPTY_EV); setErro(''); setModalEv('novo') }}>+ Novo</button>}
        </div>

        {/* Seletor de ano */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', gap: 6 }}>
          {anos.map(function(a) {
            return <button key={a} onClick={function() { setAnoFiltro(a) }} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid ' + (anoFiltro === a ? '#c9a96e' : C.border), background: anoFiltro === a ? '#1c1810' : 'none', color: anoFiltro === a ? '#c9a96e' : C.text3, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontWeight: anoFiltro === a ? 600 : 400 }}>{a}</button>
          })}
        </div>

        {/* Grade de meses */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          {loading && <div style={{ color: C.text3, textAlign: 'center', padding: 30, fontSize: 15 }}>Carregando...</div>}
          {!loading && eventosFiltrados.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: C.text3, fontSize: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
              Nenhum evento em {anoFiltro}.
            </div>
          )}
          {MESES.map(function(mes, mi) {
            var evsMes = eventosCalendario[mi] || []
            if (evsMes.length === 0 && !selected) return null
            return (
              <div key={mi} style={{ marginBottom: 14 }}>
                {evsMes.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{mes}</div>
                    {evsMes.map(function(ev) {
                      var ac = selected && selected.id === ev.id
                      var sc = EVENTO_STATUS_C[ev.status] || EVENTO_STATUS_C['Planejado']
                      return (
                        <div key={ev.id} onClick={function() { selecionarEvento(ev) }}
                          style={{ padding: '12px 14px', borderRadius: 9, border: ac ? '1px solid #c9a96e' : '1px solid ' + C.border, background: ac ? '#1c1810' : C.bgCard, cursor: 'pointer', marginBottom: 8, transition: 'all .15s' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, flex: 1, marginRight: 8 }}>{ev.nome}</div>
                            <span style={{ fontSize: 10, fontWeight: 600, color: sc.text, background: sc.bg, border: '1px solid ' + sc.border, padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap' }}>{ev.status}</span>
                          </div>
                          <div style={{ fontSize: 13, color: C.text3 }}>{fmtDate(ev.data_inicio)}{ev.data_fim ? ' — ' + fmtDate(ev.data_fim) : ''}</div>
                          {ev.local && <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>📍 {ev.local}</div>}
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* PAINEL DIREITO: detalhe do evento */}
      {selected && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Header evento */}
          <div style={{ padding: '16px 22px', borderBottom: '1px solid ' + C.border, background: '#0d0b06' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{selected.nome}</div>
                <div style={{ fontSize: 13, color: C.text3, marginTop: 3 }}>
                  {fmtDate(selected.data_inicio)}{selected.data_fim ? ' — ' + fmtDate(selected.data_fim) : ''}
                  {selected.local ? '  ·  📍 ' + selected.local : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {canManage && <button style={{ ...S.btnGhost, fontSize: 13, padding: '7px 12px' }} onClick={function() { setFormEv({ nome: selected.nome, tipo: selected.tipo, data_inicio: selected.data_inicio, data_fim: selected.data_fim || '', local: selected.local || '', descricao: selected.descricao || '', status: selected.status, capacidade: selected.capacidade || '', preco_ingresso: selected.preco_ingresso || '', observacoes: selected.observacoes || '' }); setErro(''); setModalEv(selected) }}>✏️ Editar</button>}
                <button style={{ ...S.btnGhost, fontSize: 13, padding: '7px 12px' }} onClick={function() { setSelected(null) }}>✕</button>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 }}>
              {[
                { l: 'Inscritos', v: statsEv.total, c: C.text },
                { l: 'Presentes', v: statsEv.presentes, c: '#4ade80' },
                { l: 'Compraram', v: statsEv.compraram, c: '#c9a96e' },
                { l: 'QR OK', v: statsEv.aprovados, c: '#60a5fa' },
                { l: 'Dia 1', v: statsEv.dia1, c: '#4ade80' },
                { l: 'Dia 2', v: statsEv.dia2, c: '#60a5fa' },
                { l: 'Dia 3', v: statsEv.dia3, c: '#a78bfa' },
              ].map(function(s, i) {
                return (
                  <div key={i} style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 8, padding: '9px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{s.l}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid ' + C.border, background: '#0d0b06', padding: '0 22px' }}>
            {[{ id: 'participantes', l: 'Participantes' }, { id: 'qrcodes', l: 'QR Codes' }, { id: 'info', l: 'Informacoes' }].map(function(t) {
              var ac = tab === t.id
              return <button key={t.id} onClick={function() { setTab(t.id) }} style={{ padding: '11px 16px', border: 'none', borderBottom: ac ? '2px solid #c9a96e' : '2px solid transparent', background: 'none', color: ac ? '#c9a96e' : C.text3, cursor: 'pointer', fontFamily: 'Inter,sans-serif', fontSize: 14, fontWeight: ac ? 600 : 400 }}>{t.l}</button>
            })}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>

            {/* TAB PARTICIPANTES */}
            {tab === 'participantes' && (
              <div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <input style={{ ...S.inp, flex: 1 }} placeholder="Buscar participante..." value={search} onChange={function(e) { setSearch(e.target.value) }} />
                  <button style={{ ...S.btnG, padding: '10px 14px', fontSize: 14 }} onClick={function() { setFormPart(EMPTY_PART); setErro(''); setModalPart(true) }}>+ Adicionar</button>
                </div>
                {partsFiltrados.length === 0 && <div style={{ color: C.text3, textAlign: 'center', padding: 30, fontSize: 15 }}>Nenhum participante ainda.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {partsFiltrados.map(function(p) {
                    var dias = checkinMap[p.id] || []
                    return (
                      <div key={p.id} style={{ ...S.card, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.nome}</div>
                          <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>{p.telefone}{p.email ? ' · ' + p.email : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {[1, 2, 3].map(function(d) {
                            var ok = dias.includes(d)
                            return <span key={d} style={{ width: 22, height: 22, borderRadius: '50%', background: ok ? '#14532d' : '#1c1810', border: '1px solid ' + (ok ? '#4ade80' : C.border), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: ok ? '#4ade80' : C.text3, fontWeight: 600 }}>{d}</span>
                          })}
                        </div>
                        {p.comprou && <span style={{ fontSize: 11, color: '#c9a96e', background: '#c9a96e22', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Comprou</span>}
                        {p.qr_aprovado && <span style={{ fontSize: 11, color: '#60a5fa', background: '#60a5fa22', padding: '2px 8px', borderRadius: 10 }}>QR OK</span>}
                        {auth.isAdmin && (
                          <button onClick={function() { deletarParticipante(p.id) }} style={{ ...S.btnGhost, padding: '4px 8px', fontSize: 11, color: C.red, borderColor: '#7f1d1d' }}>✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* TAB QR CODES */}
            {tab === 'qrcodes' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 15, color: C.text2 }}>
                    {statsEv.aprovados}/{statsEv.total} QR Codes aprovados para envio
                  </div>
                  {canManage && statsEv.aprovados < statsEv.total && (
                    <button style={S.btnG} onClick={aprovarTodos}>Aprovar Todos</button>
                  )}
                </div>
                {participantes.length === 0 && <div style={{ color: C.text3, textAlign: 'center', padding: 30, fontSize: 15 }}>Nenhum participante cadastrado.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {participantes.map(function(p) {
                    return (
                      <div key={p.id} style={{ ...S.card, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.nome}</div>
                          <div style={{ fontSize: 13, color: C.text3 }}>{p.telefone}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {p.qr_aprovado ? (
                            <>
                              <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Aprovado</span>
                              <button onClick={function() { abrirWhatsApp(p) }} style={{ ...S.btnGhost, fontSize: 12, padding: '5px 10px', color: '#4ade80', borderColor: '#14532d' }}>📱 WhatsApp</button>
                              <button onClick={function() { copiarQR(p.qr_token) }} style={{ ...S.btnGhost, fontSize: 12, padding: '5px 10px' }}>Copiar Link</button>
                            </>
                          ) : (
                            canManage && (
                              <button onClick={function() { setModalQR(p) }} style={{ ...S.btnG, padding: '6px 12px', fontSize: 13 }}>Aprovar e Enviar QR</button>
                            )
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* TAB INFO */}
            {tab === 'info' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  { l: 'Nome', v: selected.nome },
                  { l: 'Tipo', v: selected.tipo },
                  { l: 'Data Inicio', v: fmtDate(selected.data_inicio) },
                  { l: 'Data Fim', v: fmtDate(selected.data_fim) },
                  { l: 'Local', v: selected.local || '—' },
                  { l: 'Status', v: selected.status },
                  { l: 'Capacidade', v: selected.capacidade ? selected.capacidade + ' pessoas' : '—' },
                  { l: 'Preco Ingresso', v: selected.preco_ingresso ? fmt(selected.preco_ingresso) : '—' },
                ].map(function(f, i) {
                  return (
                    <div key={i} style={{ ...S.card, padding: '14px 16px' }}>
                      <div style={S.lbl}>{f.l}</div>
                      <div style={{ fontSize: 15, color: C.text, fontWeight: 500 }}>{f.v}</div>
                    </div>
                  )
                })}
                {selected.descricao && (
                  <div style={{ ...S.card, padding: '14px 16px', gridColumn: '1/-1' }}>
                    <div style={S.lbl}>Descricao</div>
                    <div style={{ fontSize: 15, color: C.text2, lineHeight: 1.7 }}>{selected.descricao}</div>
                  </div>
                )}
                {canManage && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
                    {selected.status === 'Planejado' && <button style={S.btnG} onClick={function() { updateStatus(selected.id, 'Em Andamento') }}>▶ Iniciar Evento</button>}
                    {selected.status === 'Em Andamento' && <button style={{ ...S.btnGhost, borderColor: '#7f1d1d', color: '#fca5a5' }} onClick={function() { updateStatus(selected.id, 'Encerrado') }}>⏹ Encerrar Evento</button>}
                    {selected.status === 'Encerrado' && <button style={S.btnGhost} onClick={function() { updateStatus(selected.id, 'Planejado') }}>↩ Reabrir</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL EVENTO */}
      {modalEv && (
        <div style={S.overlay} onClick={function() { if (!saving) setModalEv(null) }}>
          <div style={{ ...S.modal, width: 560 }} onClick={function(e) { e.stopPropagation() }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 22 }}>{modalEv === 'novo' ? 'Novo Evento' : 'Editar Evento'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={formEv.nome} onChange={function(e) { setFormEv(function(p) { return { ...p, nome: e.target.value } }) }} autoFocus /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div><label style={S.lbl}>Data Inicio *</label><input style={S.inp} type="date" value={formEv.data_inicio} onChange={function(e) { setFormEv(function(p) { return { ...p, data_inicio: e.target.value } }) }} /></div>
                <div><label style={S.lbl}>Data Fim</label><input style={S.inp} type="date" value={formEv.data_fim} onChange={function(e) { setFormEv(function(p) { return { ...p, data_fim: e.target.value } }) }} /></div>
                <div><label style={S.lbl}>Tipo</label><select style={S.inp} value={formEv.tipo} onChange={function(e) { setFormEv(function(p) { return { ...p, tipo: e.target.value } }) }}><option>Paradigma</option><option>Outro</option></select></div>
                <div><label style={S.lbl}>Status</label><select style={S.inp} value={formEv.status} onChange={function(e) { setFormEv(function(p) { return { ...p, status: e.target.value } }) }}><option>Planejado</option><option>Em Andamento</option><option>Encerrado</option></select></div>
                <div><label style={S.lbl}>Local</label><input style={S.inp} value={formEv.local} onChange={function(e) { setFormEv(function(p) { return { ...p, local: e.target.value } }) }} placeholder="Ex: Storydoing" /></div>
                <div><label style={S.lbl}>Capacidade</label><input style={S.inp} type="number" value={formEv.capacidade} onChange={function(e) { setFormEv(function(p) { return { ...p, capacidade: e.target.value } }) }} placeholder="Max de pessoas" /></div>
                <div><label style={S.lbl}>Preco Ingresso (R$)</label><input style={S.inp} type="number" value={formEv.preco_ingresso} onChange={function(e) { setFormEv(function(p) { return { ...p, preco_ingresso: e.target.value } }) }} placeholder="997.00" /></div>
              </div>
              <div><label style={S.lbl}>Descricao</label><textarea style={{ ...S.inp, height: 70, resize: 'vertical' }} value={formEv.descricao} onChange={function(e) { setFormEv(function(p) { return { ...p, descricao: e.target.value } }) }} /></div>
            </div>
            {erro && <div style={{ marginTop: 14, background: '#7f1d1d22', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', fontSize: 14, borderRadius: 8 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
              <button style={S.btnGhost} onClick={function() { setModalEv(null) }} disabled={saving}>Cancelar</button>
              <button style={S.btnG} onClick={salvarEvento} disabled={saving}>{saving ? 'Salvando...' : modalEv === 'novo' ? 'Criar Evento' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARTICIPANTE */}
      {modalPart && (
        <div style={S.overlay} onClick={function() { if (!saving) setModalPart(false) }}>
          <div style={{ ...S.modal, width: 460 }} onClick={function(e) { e.stopPropagation() }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 22 }}>Adicionar Participante</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={formPart.nome} onChange={function(e) { setFormPart(function(p) { return { ...p, nome: e.target.value } }) }} autoFocus /></div>
              <div><label style={S.lbl}>Telefone *</label><input style={S.inp} value={formPart.telefone} onChange={function(e) { setFormPart(function(p) { return { ...p, telefone: e.target.value } }) }} /></div>
              <div><label style={S.lbl}>Email</label><input style={S.inp} value={formPart.email} onChange={function(e) { setFormPart(function(p) { return { ...p, email: e.target.value } }) }} /></div>
              <div><label style={S.lbl}>CPF</label><input style={S.inp} value={formPart.cpf} onChange={function(e) { setFormPart(function(p) { return { ...p, cpf: e.target.value } }) }} /></div>
            </div>
            {erro && <div style={{ marginTop: 12, background: '#7f1d1d22', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', fontSize: 14, borderRadius: 8 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
              <button style={S.btnGhost} onClick={function() { setModalPart(false) }} disabled={saving}>Cancelar</button>
              <button style={S.btnG} onClick={adicionarParticipante} disabled={saving}>{saving ? 'Salvando...' : 'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL APROVAR QR */}
      {modalQR && (
        <div style={S.overlay} onClick={function() { setModalQR(null) }}>
          <div style={{ ...S.modal, width: 420, textAlign: 'center' }} onClick={function(e) { e.stopPropagation() }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📱</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Aprovar e Enviar QR Code</div>
            <div style={{ fontSize: 14, color: C.text2, marginBottom: 6 }}><strong style={{ color: C.text }}>{modalQR.nome}</strong></div>
            <div style={{ fontSize: 14, color: C.text3, marginBottom: 20 }}>
              O QR Code sera enviado via WhatsApp para <strong style={{ color: C.text }}>{modalQR.telefone}</strong>.<br />
              Esta acao aprova o participante para check-in.
            </div>
            <div style={{ background: C.bgHover, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.text3, marginBottom: 20, wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {getQRUrl(modalQR.qr_token)}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button style={S.btnGhost} onClick={function() { setModalQR(null) }}>Cancelar</button>
              <button style={S.btnG} onClick={function() { aprovarEnviarQR(modalQR) }} disabled={qrLoading}>{qrLoading ? 'Aprovando...' : 'Aprovar e Abrir WhatsApp'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
