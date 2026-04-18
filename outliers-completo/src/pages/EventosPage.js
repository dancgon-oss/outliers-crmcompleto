import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmtDate, C } from '../lib/ui'
import QRCode from 'qrcode'

export default function EventosPage() {
  var auth = useAuth()
  var [eventos, setEventos] = useState([])
  var [selected, setSelected] = useState(null)
  var [participantes, setParticipantes] = useState([])
  var [loading, setLoading] = useState(true)
  var [showNovoEvento, setShowNovoEvento] = useState(false)
  var [showNovoPart, setShowNovoPart] = useState(false)
  var [showQR, setShowQR] = useState(null)
  var [qrDataUrl, setQrDataUrl] = useState('')
  var [saving, setSaving] = useState(false)
  var [novoEvento, setNovoEvento] = useState({ nome: 'Paradigma', tipo: 'Paradigma', data_inicio: '', data_fim: '', local: '', descricao: '' })
  var [novoPart, setNovoPart] = useState({ nome: '', email: '', telefone: '', cpf: '' })
  var [search, setSearch] = useState('')

  useEffect(function() { fetchEventos() }, [])

  async function fetchEventos() {
    setLoading(true)
    var { data } = await supabase.from('eventos').select('*').order('data_inicio', { ascending: false })
    setEventos(data || [])
    setLoading(false)
  }

  async function fetchParticipantes(id) {
    var { data } = await supabase.from('participantes').select('*').eq('evento_id', id).order('created_at')
    setParticipantes(data || [])
  }

  async function salvarEvento() {
    setSaving(true)
    var { data } = await supabase.from('eventos').insert({ ...novoEvento, criado_por: auth.profile ? auth.profile.id : null }).select().single()
    if (data) { await fetchEventos(); setShowNovoEvento(false); setNovoEvento({ nome:'Paradigma',tipo:'Paradigma',data_inicio:'',data_fim:'',local:'',descricao:'' }) }
    setSaving(false)
  }

  async function salvarParticipante() {
    if (!novoPart.nome || !novoPart.telefone || !selected) return
    setSaving(true)
    await supabase.from('participantes').insert({ ...novoPart, evento_id: selected.id })
    await fetchParticipantes(selected.id)
    setShowNovoPart(false)
    setNovoPart({ nome:'',email:'',telefone:'',cpf:'' })
    setSaving(false)
  }

  async function abrirQR(part) {
    setShowQR(part)
    var url = window.location.origin + '/checkin/' + part.qr_token
    var dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#0a0900', light: '#f0ead8' } })
    setQrDataUrl(dataUrl)
  }


  // Envia QR individual via WhatsApp
  async function enviarQRWhatsApp(part) {
    if (!part.telefone) { alert('Participante sem telefone cadastrado.'); return }
    var url = window.location.origin + '/checkin/' + part.qr_token
    var nomeEvento = selected ? selected.nome : 'Evento'
    var dataEvento = selected ? fmtDate(selected.data_inicio) : ''
    var msg = 'Ola ' + part.nome + '!\n\nSua vaga no *' + nomeEvento + '* (' + dataEvento + ') esta confirmada!\n\nSeu QR Code de check-in exclusivo:\n' + url + '\n\nApresente este link na entrada do evento para fazer seu check-in. Ate la!'
    var tel = part.telefone.replace(/\D/g, '')
    if (tel.length === 11) tel = '55' + tel
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank')
  }

  // Envia QR para TODOS
  async function enviarParaTodos() {
    if (!participantes.length) { alert('Nenhum participante cadastrado.'); return }
    var comTelefone = participantes.filter(function(p){ return p.telefone })
    if (!comTelefone.length) { alert('Nenhum participante com telefone cadastrado.'); return }
    var confirmar = window.confirm('Enviar QR Code pelo WhatsApp para ' + comTelefone.length + ' participante(s)?')
    if (!confirmar) return
    for (var i = 0; i < comTelefone.length; i++) {
      enviarQRWhatsApp(comTelefone[i])
      await new Promise(function(r){ setTimeout(r, 1000) })
    }
  }

  var filtrados = participantes.filter(function(p) {
    return p.nome.toLowerCase().includes(search.toLowerCase()) || (p.telefone||'').includes(search)
  })

  var stats = {
    inscritos: participantes.length,
    presentes: participantes.filter(function(p){ return p.checkin_at }).length,
    compraram: participantes.filter(function(p){ return p.comprou }).length,
  }

  var S = {
    card: { background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10 },
    inp: { background: C.bgHover, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', fontSize: 13, borderRadius: 8, outline: 'none', fontFamily: 'Inter,sans-serif', width: '100%', transition: 'border-color .15s' },
    btnG: { background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '9px 18px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '8px 16px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, cursor: 'pointer' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    modal: { background: '#141209', border: '1px solid ' + C.border2, borderRadius: 14, padding: 28, width: 500, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' },
    lbl: { display: 'block', fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 },
  }

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter,sans-serif', background: C.bg }}>
      {/* Lista de eventos */}
      <div style={{ width: selected ? 280 : '100%', borderRight: selected ? '1px solid ' + C.border : 'none', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgCard }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Eventos</span>
          {auth.isAdmin && <button style={S.btnG} onClick={function(){setShowNovoEvento(true)}}>+ Novo</button>}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 13 }}>Carregando...</div>}
          {eventos.map(function(ev) {
            var active = selected && selected.id === ev.id
            var statusCor = ev.status === 'Em Andamento' ? '#4ade80' : ev.status === 'Encerrado' ? C.text3 : C.yellow
            return (
              <div key={ev.id} onClick={function(){ setSelected(ev); fetchParticipantes(ev.id) }}
                style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.border, background: active ? C.bgHover : 'transparent', cursor: 'pointer', transition: 'background .1s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{ev.nome}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusCor, background: statusCor + '22', padding: '2px 8px', borderRadius: 20 }}>{ev.status}</span>
                </div>
                <div style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>{fmtDate(ev.data_inicio)}{ev.data_fim ? ' → ' + fmtDate(ev.data_fim) : ''}</div>
                {ev.local && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>📍 {ev.local}</div>}
              </div>
            )
          })}
          {!loading && eventos.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum evento.</div>}
        </div>
      </div>

      {/* Detalhe */}
      {selected && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid ' + C.border, background: C.bgCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{selected.nome}</div>
              <div style={{ fontSize: 12, color: C.text3, marginTop: 3, fontFamily: 'monospace' }}>{fmtDate(selected.data_inicio)}{selected.local ? ' · ' + selected.local : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {auth.isAdmin && (
                <select style={{ ...S.inp, width: 160 }} value={selected.status}
                  onChange={async function(e) {
                    await supabase.from('eventos').update({ status: e.target.value }).eq('id', selected.id)
                    setEventos(function(prev){ return prev.map(function(ev){ return ev.id === selected.id ? {...ev,status:e.target.value} : ev }) })
                    setSelected(function(prev){ return {...prev,status:e.target.value} })
                  }}>
                  {['Planejado','Em Andamento','Encerrado'].map(function(s){ return <option key={s}>{s}</option> })}
                </select>
              )}
              <button style={S.btnGhost} onClick={function(){setSelected(null)}}>✕</button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', borderBottom: '1px solid ' + C.border }}>
            {[
              { label: 'Inscritos', value: stats.inscritos, icon: '👥' },
              { label: 'Presentes', value: stats.presentes, icon: '✅', pct: stats.inscritos ? Math.round(stats.presentes/stats.inscritos*100) : 0 },
              { label: 'Compraram', value: stats.compraram, icon: '💰', gold: true },
              { label: 'Conversao', value: stats.inscritos ? Math.round(stats.compraram/stats.inscritos*100) + '%' : '0%', icon: '📈', gold: true },
            ].map(function(s, i) {
              return (
                <div key={i} style={{ flex: 1, padding: '14px 18px', borderRight: i < 3 ? '1px solid ' + C.border : 'none', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.gold ? C.gold : C.text }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{s.label}</div>
                  {s.pct !== undefined && <div style={{ fontSize: 10, color: C.text3, marginTop: 1 }}>{s.pct}%</div>}
                </div>
              )
            })}
          </div>

          {/* Participantes */}
          <div style={{ padding: '16px 22px', flex: 1, overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <input style={{ ...S.inp, flex: 1 }} placeholder="Buscar participante..." value={search} onChange={function(e){setSearch(e.target.value)}} />
              <button style={S.btnG} onClick={function(){setShowNovoPart(true)}}>+ Participante</button>
              <label style={{ ...S.btnGhost, padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                📂 CSV
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={async function(e) {
                  var file = e.target.files[0]; if (!file || !selected) return
                  var text = await file.text()
                  var lines = text.split('\n').filter(Boolean).slice(1)
                  var rows = lines.map(function(l) {
                    var cols = l.split(',').map(function(c){ return c.trim().replace(/^"|"$/g,'') })
                    return { nome: cols[0], email: cols[1], telefone: cols[2], cpf: cols[3], evento_id: selected.id }
                  }).filter(function(r){ return r.nome && r.telefone })
                  if (rows.length) { await supabase.from('participantes').insert(rows); await fetchParticipantes(selected.id) }
                }} />
              </label>
            </div>

            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 110px 80px 80px 90px', padding: '10px 16px', borderBottom: '1px solid ' + C.border }}>
                {['Nome','Telefone','Check-in','Comprou','Contrato','QR'].map(function(h,i){ return <span key={i} style={{ fontSize: 10, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span> })}
              </div>
              {filtrados.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum participante.</div>}
              {filtrados.map(function(p, i, arr) {
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 110px 80px 80px 90px', padding: '11px 16px', borderBottom: i < arr.length-1 ? '1px solid ' + C.border : 'none', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{p.nome}</div>
                      {p.email && <div style={{ fontSize: 11, color: C.text3 }}>{p.email}</div>}
                    </div>
                    <div style={{ fontSize: 12, color: C.text2, fontFamily: 'monospace' }}>{p.telefone}</div>
                    <div style={{ fontSize: 11 }}>
                      {p.checkin_at
                        ? <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ {new Date(p.checkin_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
                        : <span style={{ color: C.text3 }}>Pendente</span>}
                    </div>
                    <div style={{ fontSize: 11 }}>{p.comprou ? <span style={{ color: C.gold, fontWeight: 600 }}>Sim</span> : <span style={{ color: C.text3 }}>—</span>}</div>
                    <div style={{ fontSize: 11 }}>{p.comprou ? <span style={{ color: '#4ade80' }}>✓</span> : <span style={{ color: C.text3 }}>—</span>}</div>
                    <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 11 }} onClick={function(){ abrirQR(p) }}>QR ↗</button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Novo Evento */}
      {showNovoEvento && (
        <div style={S.overlay} onClick={function(){setShowNovoEvento(false)}}>
          <div style={S.modal} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 22 }}>Novo Evento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={S.lbl}>Nome</label><input style={S.inp} value={novoEvento.nome} onChange={function(e){setNovoEvento(function(p){return {...p,nome:e.target.value}})}} /></div>
              <div style={{ display:'flex', gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Data Inicio</label><input style={S.inp} type="date" value={novoEvento.data_inicio} onChange={function(e){setNovoEvento(function(p){return {...p,data_inicio:e.target.value}})}} /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>Data Fim</label><input style={S.inp} type="date" value={novoEvento.data_fim} onChange={function(e){setNovoEvento(function(p){return {...p,data_fim:e.target.value}})}} /></div>
              </div>
              <div><label style={S.lbl}>Local</label><input style={S.inp} value={novoEvento.local} onChange={function(e){setNovoEvento(function(p){return {...p,local:e.target.value}})}} /></div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:22 }}>
              <button style={S.btnGhost} onClick={function(){setShowNovoEvento(false)}}>Cancelar</button>
              <button style={S.btnG} onClick={salvarEvento} disabled={saving||!novoEvento.data_inicio}>{saving?'Salvando...':'Criar Evento'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Novo Participante */}
      {showNovoPart && (
        <div style={S.overlay} onClick={function(){setShowNovoPart(false)}}>
          <div style={S.modal} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 22 }}>Adicionar Participante</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={novoPart.nome} onChange={function(e){setNovoPart(function(p){return {...p,nome:e.target.value}})}} /></div>
              <div style={{ display:'flex', gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Telefone *</label><input style={S.inp} value={novoPart.telefone} onChange={function(e){setNovoPart(function(p){return {...p,telefone:e.target.value}})}} /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>CPF</label><input style={S.inp} value={novoPart.cpf} onChange={function(e){setNovoPart(function(p){return {...p,cpf:e.target.value}})}} /></div>
              </div>
              <div><label style={S.lbl}>E-mail</label><input style={S.inp} type="email" value={novoPart.email} onChange={function(e){setNovoPart(function(p){return {...p,email:e.target.value}})}} /></div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:22 }}>
              <button style={S.btnGhost} onClick={function(){setShowNovoPart(false)}}>Cancelar</button>
              <button style={S.btnG} onClick={salvarParticipante} disabled={saving||!novoPart.nome||!novoPart.telefone}>{saving?'Salvando...':'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: QR Code */}
      {showQR && (
        <div style={S.overlay} onClick={function(){setShowQR(null)}}>
          <div style={{ ...S.modal, width:340, textAlign:'center' }} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize:18,fontWeight:700,color:C.text,marginBottom:4 }}>{showQR.nome}</div>
            <div style={{ fontSize:12,color:C.text3,marginBottom:20,fontFamily:'monospace' }}>{showQR.telefone}</div>
            {qrDataUrl && <div style={{ background:'#f0ead8',padding:16,display:'inline-block',borderRadius:8,marginBottom:16 }}><img src={qrDataUrl} alt="QR" style={{ width:220,height:220,display:'block' }} /></div>}
            <div style={{ fontSize:12,color:C.text3,marginBottom:20,lineHeight:1.6 }}>QR Code unico para check-in no evento.</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <button style={S.btnGhost} onClick={function(){setShowQR(null)}}>Fechar</button>
              <button style={S.btnG} onClick={function(){ var a=document.createElement('a'); a.download='qr-'+showQR.nome.replace(/\s+/g,'-')+'.png'; a.href=qrDataUrl; a.click() }}>⬇ Baixar</button>
              <button onClick={function(){ enviarQRWhatsApp(showQR) }} style={{ background:'#14532d',border:'1px solid #16a34a',color:'#4ade80',padding:'9px 16px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:13,fontWeight:600,cursor:'pointer' }}>📱 WhatsApp</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
