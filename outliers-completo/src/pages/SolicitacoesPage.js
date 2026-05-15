import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { C, fmt, fmtDate, formatTel, unformatTel, formatCPF, unformatCPF } from '../lib/ui'

var TIPOS = [
  { id:'cliente_novo',   label:'Cadastrar novo cliente',  icon:'👤', auto:true },
  { id:'venda_nova',     label:'Registrar venda',         icon:'💰', auto:true },
  { id:'locacao_nova',   label:'Nova locação Storydoing', icon:'🏢', auto:true },
  { id:'conta_pagar',    label:'Conta a pagar',           icon:'📄', auto:true },
  { id:'relatorio',      label:'Pedido de relatório',     icon:'📊', auto:false },
  { id:'informacao',     label:'Informação',              icon:'❓', auto:false },
  { id:'outro',          label:'Outro',                   icon:'✉️', auto:false },
]
var PRIORIDADES = [
  { id:'baixa',    label:'Baixa',    color:'#7a6a4a' },
  { id:'normal',   label:'Normal',   color:'#c9a96e' },
  { id:'alta',     label:'Alta',     color:'#fbbf24' },
  { id:'urgente',  label:'Urgente',  color:'#f87171' },
]
var STATUS_C = {
  'Pendente':     { bg:'#78350f22', border:'#78350f', text:'#fbbf24' },
  'Em andamento': { bg:'#1e3a8a22', border:'#1e3a8a', text:'#60a5fa' },
  'Concluida':    { bg:'#14532d22', border:'#14532d', text:'#4ade80' },
  'Cancelada':    { bg:'#1c1810',   border:'#2a2415', text:'#7a6a4a' },
}

var inputStyle = {
  background:'#0a0900', border:'1px solid #2a2415', borderRadius:6,
  padding:'8px 12px', color:'#f0ead8', fontSize:13, fontFamily:'Inter,sans-serif', outline:'none', width:'100%',
}
var btnPrimary = {
  background:'linear-gradient(180deg,#c9a96e,#a07840)', border:'none', color:'#1a1a1a',
  padding:'8px 14px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'Inter,sans-serif',
}
var btnGhost = {
  background:'#1c1810', border:'1px solid #2a2415', color:'#a08658',
  padding:'6px 10px', borderRadius:6, cursor:'pointer', fontSize:12, fontFamily:'Inter,sans-serif',
}
var btnAprovar = {
  background:'linear-gradient(180deg,#4ade80,#14532d)', border:'none', color:'#0a0900',
  padding:'10px 18px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'Inter,sans-serif',
}

function relTime(ts) {
  if (!ts) return ''
  var d = new Date(ts); var diff = (Date.now() - d.getTime())/1000
  if (diff < 60) return 'agora'
  if (diff < 3600) return Math.floor(diff/60)+'min'
  if (diff < 86400) return Math.floor(diff/3600)+'h'
  return d.toLocaleDateString('pt-BR')
}

function emptyPayload(tipo) {
  if (tipo === 'cliente_novo') return { nome:'', email:'', telefone:'', cpf:'', origem:'Solicitação', programa:'Paradigma', observacoes:'' }
  if (tipo === 'conta_pagar') return { descricao:'', fornecedor:'', categoria:'', valor:'', vencimento:'', forma_pagamento:'PIX', observacoes:'' }
  if (tipo === 'locacao_nova') return { sala:'black', data_locacao:'', data_fim:'', hora_inicio:'', hora_fim:'', valor:'', locador_nome:'', locador_telefone:'', locador_email:'', observacoes:'' }
  if (tipo === 'venda_nova') return { cliente_id:'', curso_id:'', modalidade:'Parcelado', valor_total:'', desconto:'', forma_pagamento:'PIX', observacoes:'' }
  return {}
}

function PayloadView({ tipo, payload }) {
  if (!payload || Object.keys(payload).length === 0) return null
  var rows = []
  if (tipo === 'cliente_novo') {
    rows = [
      ['Nome', payload.nome],
      ['E-mail', payload.email],
      ['Telefone', formatTel(payload.telefone)],
      ['CPF', formatCPF(payload.cpf)],
      ['Origem', payload.origem],
      ['Programa', payload.programa],
      ['Observações', payload.observacoes],
    ]
  } else if (tipo === 'conta_pagar') {
    rows = [
      ['Descrição', payload.descricao],
      ['Fornecedor', payload.fornecedor],
      ['Categoria', payload.categoria],
      ['Valor', payload.valor ? fmt(payload.valor) : ''],
      ['Vencimento', payload.vencimento ? fmtDate(payload.vencimento) : ''],
      ['Forma', payload.forma_pagamento],
      ['Observações', payload.observacoes],
    ]
  } else if (tipo === 'locacao_nova') {
    rows = [
      ['Sala', payload.sala === 'black' ? '⚫ Black' : '⚪ White'],
      ['Data início', payload.data_locacao ? fmtDate(payload.data_locacao) : ''],
      ['Data fim', payload.data_fim ? fmtDate(payload.data_fim) : ''],
      ['Hora início', payload.hora_inicio],
      ['Hora fim', payload.hora_fim],
      ['Valor', payload.valor ? fmt(payload.valor) : ''],
      ['Locador', payload.locador_nome],
      ['Tel. locador', formatTel(payload.locador_telefone)],
      ['E-mail', payload.locador_email],
    ]
  } else if (tipo === 'venda_nova') {
    rows = [
      ['Cliente ID', payload.cliente_id],
      ['Curso ID', payload.curso_id],
      ['Modalidade', payload.modalidade],
      ['Valor total', payload.valor_total ? fmt(payload.valor_total) : ''],
      ['Desconto', payload.desconto ? fmt(payload.desconto) : ''],
      ['Forma', payload.forma_pagamento],
    ]
  }
  return (
    <div style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:8, padding:'12px 16px', marginBottom:14 }}>
      <div style={{ fontSize:11, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8, fontWeight:600 }}>Dados a serem cadastrados</div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <tbody>
          {rows.filter(function(r){ return r[1] }).map(function(r,i) {
            return (
              <tr key={i}>
                <td style={{ padding:'4px 8px 4px 0', fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.05em', whiteSpace:'nowrap', verticalAlign:'top' }}>{r[0]}</td>
                <td style={{ padding:'4px 0', fontSize:13, color:C.text }}>{r[1]}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PayloadForm({ tipo, payload, onChange }) {
  function set(k, v) { onChange({ ...payload, [k]: v }) }
  if (tipo === 'cliente_novo') {
    return (<>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div><label style={lbl}>Nome*</label><input style={inputStyle} value={payload.nome||''} onChange={function(e){set('nome',e.target.value)}} /></div>
        <div><label style={lbl}>E-mail</label><input type="email" style={inputStyle} value={payload.email||''} onChange={function(e){set('email',e.target.value)}} /></div>
        <div><label style={lbl}>Telefone</label><input style={inputStyle} value={payload.telefone||''} placeholder="(11) 98765-4321" onChange={function(e){set('telefone',e.target.value)}} /></div>
        <div><label style={lbl}>CPF</label><input style={inputStyle} value={payload.cpf||''} placeholder="000.000.000-00" onChange={function(e){set('cpf',e.target.value)}} /></div>
        <div><label style={lbl}>Origem</label>
          <select style={inputStyle} value={payload.origem||'Solicitação'} onChange={function(e){set('origem',e.target.value)}}>
            {['Solicitação','Paradigma','Indicação','Renovação','Instagram','TikTok','YouTube','Facebook','Outro'].map(function(o){return <option key={o}>{o}</option>})}
          </select>
        </div>
        <div><label style={lbl}>Programa</label><input style={inputStyle} value={payload.programa||''} onChange={function(e){set('programa',e.target.value)}} /></div>
      </div>
      <div style={{ marginTop:10 }}><label style={lbl}>Observações</label><textarea style={{...inputStyle,resize:'vertical'}} rows={2} value={payload.observacoes||''} onChange={function(e){set('observacoes',e.target.value)}} /></div>
    </>)
  }
  if (tipo === 'conta_pagar') {
    return (<>
      <div><label style={lbl}>Descrição*</label><input style={inputStyle} value={payload.descricao||''} onChange={function(e){set('descricao',e.target.value)}} /></div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
        <div><label style={lbl}>Fornecedor</label><input style={inputStyle} value={payload.fornecedor||''} onChange={function(e){set('fornecedor',e.target.value)}} /></div>
        <div><label style={lbl}>Categoria</label>
          <select style={inputStyle} value={payload.categoria||''} onChange={function(e){set('categoria',e.target.value)}}>
            <option value="">—</option>
            {['Salários e prestadores','Marketing','Software','Infraestrutura','Aluguel','Equipamento','Impostos','Bancário','Outras'].map(function(c){return <option key={c}>{c}</option>})}
          </select>
        </div>
        <div><label style={lbl}>Valor (R$)*</label><input type="number" step="0.01" style={inputStyle} value={payload.valor||''} onChange={function(e){set('valor',e.target.value)}} /></div>
        <div><label style={lbl}>Vencimento*</label><input type="date" style={inputStyle} value={payload.vencimento||''} onChange={function(e){set('vencimento',e.target.value)}} /></div>
      </div>
      <div style={{ marginTop:10 }}><label style={lbl}>Forma de pagamento</label>
        <select style={inputStyle} value={payload.forma_pagamento||''} onChange={function(e){set('forma_pagamento',e.target.value)}}>
          {['PIX','Boleto','Cartão','Dinheiro','Transferência','Outro'].map(function(o){return <option key={o}>{o}</option>})}
        </select>
      </div>
      <div style={{ marginTop:10 }}><label style={lbl}>Observações</label><textarea style={{...inputStyle,resize:'vertical'}} rows={2} value={payload.observacoes||''} onChange={function(e){set('observacoes',e.target.value)}} /></div>
    </>)
  }
  if (tipo === 'locacao_nova') {
    return (<>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div><label style={lbl}>Sala*</label>
          <select style={inputStyle} value={payload.sala||'black'} onChange={function(e){set('sala',e.target.value)}}>
            <option value="black">⚫ Black</option>
            <option value="white">⚪ White</option>
          </select>
        </div>
        <div><label style={lbl}>Valor (R$)*</label><input type="number" step="0.01" style={inputStyle} value={payload.valor||''} onChange={function(e){set('valor',e.target.value)}} /></div>
        <div><label style={lbl}>Data início*</label><input type="date" style={inputStyle} value={payload.data_locacao||''} onChange={function(e){set('data_locacao',e.target.value)}} /></div>
        <div><label style={lbl}>Data fim</label><input type="date" style={inputStyle} value={payload.data_fim||''} onChange={function(e){set('data_fim',e.target.value)}} /></div>
        <div><label style={lbl}>Hora início</label><input type="time" style={inputStyle} value={payload.hora_inicio||''} onChange={function(e){set('hora_inicio',e.target.value)}} /></div>
        <div><label style={lbl}>Hora fim</label><input type="time" style={inputStyle} value={payload.hora_fim||''} onChange={function(e){set('hora_fim',e.target.value)}} /></div>
      </div>
      <div style={{ marginTop:10 }}><label style={lbl}>Locador (nome)*</label><input style={inputStyle} value={payload.locador_nome||''} onChange={function(e){set('locador_nome',e.target.value)}} /></div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
        <div><label style={lbl}>Telefone locador</label><input style={inputStyle} value={payload.locador_telefone||''} placeholder="(11) 98765-4321" onChange={function(e){set('locador_telefone',e.target.value)}} /></div>
        <div><label style={lbl}>E-mail locador</label><input type="email" style={inputStyle} value={payload.locador_email||''} onChange={function(e){set('locador_email',e.target.value)}} /></div>
      </div>
    </>)
  }
  return null
}

var lbl = { display:'block', fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:4 }

export default function SolicitacoesPage() {
  var auth = useAuth()
  var ehStaff = auth.isAdmin || auth.isComercial || auth.isFinanceiro || auth.isOperacional
  var [solicitacoes, setSolicitacoes] = useState([])
  var [autoresMap, setAutoresMap] = useState({})
  var [loading, setLoading] = useState(true)
  var [filtroStatus, setFiltroStatus] = useState('Todos')
  var [filtroTipo, setFiltroTipo] = useState('Todos')
  var [showNova, setShowNova] = useState(false)
  var [nova, setNova] = useState({ tipo:'cliente_novo', assunto:'', descricao:'', prioridade:'normal', payload:emptyPayload('cliente_novo') })
  var [saving, setSaving] = useState(false)
  var [aberta, setAberta] = useState(null)
  var [mensagens, setMensagens] = useState([])
  var [novaMsg, setNovaMsg] = useState('')
  var [executando, setExecutando] = useState(false)

  async function carregar() {
    setLoading(true)
    var r = await supabase.from('solicitacoes').select('*').order('created_at', { ascending: false })
    setSolicitacoes(r.data || [])
    var ids = Array.from(new Set((r.data || []).map(function(s){ return s.criado_por }).filter(Boolean)))
    if (ids.length) {
      var rp = await supabase.from('profiles').select('id,nome,role').in('id', ids)
      var map = {}
      ;(rp.data || []).forEach(function(p){ map[p.id] = p })
      setAutoresMap(map)
    }
    setLoading(false)
  }
  useEffect(function(){ carregar() }, [])

  async function abrirSolicitacao(s) {
    setAberta(s); setMensagens([])
    var r = await supabase.from('solicitacao_mensagens').select('*').eq('solicitacao_id', s.id).order('created_at')
    setMensagens(r.data || [])
  }

  function mudarTipo(tipo) {
    setNova(function(p){ return { ...p, tipo:tipo, payload: emptyPayload(tipo) } })
  }

  async function criar() {
    if (!nova.assunto.trim()) { alert('Assunto obrigatório.'); return }
    var payloadFinal = { ...(nova.payload || {}) }
    // Limpa CPF/telefone (deixa só dígitos)
    if (payloadFinal.telefone) payloadFinal.telefone = unformatTel(payloadFinal.telefone)
    if (payloadFinal.cpf) payloadFinal.cpf = unformatCPF(payloadFinal.cpf)
    if (payloadFinal.locador_telefone) payloadFinal.locador_telefone = unformatTel(payloadFinal.locador_telefone)

    setSaving(true)
    var sol = {
      tipo: nova.tipo,
      assunto: nova.assunto.trim(),
      descricao: nova.descricao.trim() || null,
      prioridade: nova.prioridade,
      criado_por: auth.profile && auth.profile.id,
      payload: payloadFinal,
    }
    var r = await supabase.from('solicitacoes').insert(sol).select().single()
    if (r.error) { alert('Erro: ' + r.error.message); setSaving(false); return }
    if (nova.descricao.trim()) {
      await supabase.from('solicitacao_mensagens').insert({
        solicitacao_id: r.data.id,
        autor_id: auth.profile && auth.profile.id,
        autor_nome: auth.profile && auth.profile.nome,
        texto: nova.descricao.trim(),
      })
    }
    setSaving(false); setShowNova(false)
    setNova({ tipo:'cliente_novo', assunto:'', descricao:'', prioridade:'normal', payload:emptyPayload('cliente_novo') })
    carregar()
  }

  async function enviarMsg() {
    if (!aberta || !novaMsg.trim()) return
    var txt = novaMsg.trim()
    setNovaMsg('')
    var r = await supabase.from('solicitacao_mensagens').insert({
      solicitacao_id: aberta.id,
      autor_id: auth.profile && auth.profile.id,
      autor_nome: auth.profile && auth.profile.nome,
      texto: txt,
    }).select().single()
    if (r.error) { alert('Erro: ' + r.error.message); return }
    setMensagens(function(prev){ return prev.concat([r.data]) })
    if (ehStaff && aberta.status === 'Pendente' && (aberta.criado_por !== (auth.profile && auth.profile.id))) {
      await supabase.from('solicitacoes').update({ status: 'Em andamento', updated_at: new Date().toISOString() }).eq('id', aberta.id)
      setAberta(function(p){ return { ...p, status: 'Em andamento' } })
      carregar()
    }
  }

  async function aprovarExecutar() {
    if (!aberta) return
    if (!window.confirm('Aprovar e executar esta solicitação? Os dados serão criados automaticamente no CRM.')) return
    setExecutando(true)
    var r = await supabase.rpc('executar_solicitacao', { p_id: aberta.id })
    setExecutando(false)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    if (!r.data || !r.data.ok) { alert('Erro: ' + ((r.data && r.data.error) || 'desconhecido')); return }
    alert('✅ Solicitação executada com sucesso!\n\nResultado: ' + JSON.stringify(r.data.resultado, null, 2))
    setAberta(null)
    carregar()
  }

  async function mudarStatus(s, novo) {
    var patch = { status: novo, updated_at: new Date().toISOString() }
    if (novo === 'Concluida' || novo === 'Cancelada') {
      patch.fechado_em = new Date().toISOString()
      patch.fechado_por = auth.profile && auth.profile.id
    } else {
      patch.fechado_em = null
      patch.fechado_por = null
    }
    var r = await supabase.from('solicitacoes').update(patch).eq('id', s.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    if (aberta && aberta.id === s.id) setAberta(function(p){ return { ...p, ...patch } })
    carregar()
  }

  var filtradas = solicitacoes.filter(function(s) {
    if (filtroStatus !== 'Todos' && s.status !== filtroStatus) return false
    if (filtroTipo !== 'Todos' && s.tipo !== filtroTipo) return false
    return true
  })

  var tipoAberta = aberta ? (TIPOS.find(function(t){ return t.id === aberta.tipo }) || TIPOS[6]) : null
  var podeExecutar = aberta && tipoAberta && tipoAberta.auto && ehStaff && aberta.status !== 'Concluida' && aberta.status !== 'Cancelada'

  return (
    <div style={{ padding:'24px 28px', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif', overflowY:'auto' }}>
      <div style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>📨 Solicitações</div>
          <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>
            {ehStaff ? 'Pedidos recebidos. Aprove e o sistema cadastra automaticamente no CRM.' : 'Preencha os dados — o time aprova e o sistema cadastra automaticamente.'}
          </div>
        </div>
        <button style={btnPrimary} onClick={function(){ setShowNova(true) }}>+ Nova solicitação</button>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <select style={{ ...inputStyle, width:170 }} value={filtroStatus} onChange={function(e){ setFiltroStatus(e.target.value) }}>
          {['Todos','Pendente','Em andamento','Concluida','Cancelada'].map(function(s){ return <option key={s}>{s}</option> })}
        </select>
        <select style={{ ...inputStyle, width:220 }} value={filtroTipo} onChange={function(e){ setFiltroTipo(e.target.value) }}>
          <option value="Todos">Todos os tipos</option>
          {TIPOS.map(function(t){ return <option key={t.id} value={t.id}>{t.icon} {t.label}</option> })}
        </select>
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:24, color:C.text3, fontStyle:'italic' }}>Carregando…</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding:30, textAlign:'center', color:C.text3, fontStyle:'italic' }}>Nenhuma solicitação.</div>
        ) : filtradas.map(function(s, i, arr) {
          var tipoObj = TIPOS.find(function(t){ return t.id === s.tipo }) || TIPOS[6]
          var prior = PRIORIDADES.find(function(p){ return p.id === s.prioridade }) || PRIORIDADES[1]
          var sc = STATUS_C[s.status] || STATUS_C.Pendente
          var autor = autoresMap[s.criado_por]
          return (
            <div key={s.id} onClick={function(){ abrirSolicitacao(s) }}
                 style={{ padding:'14px 18px', borderBottom: i<arr.length-1 ? '1px solid #1c1810' : 'none', cursor:'pointer', transition:'background .15s' }}
                 onMouseEnter={function(e){ e.currentTarget.style.background = '#1c1810' }}
                 onMouseLeave={function(e){ e.currentTarget.style.background = 'transparent' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:16 }}>{tipoObj.icon}</span>
                    <span style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em' }}>{tipoObj.label}</span>
                    <span style={{ fontSize:11, color:prior.color, fontWeight:600 }}>{prior.label.toUpperCase()}</span>
                    {tipoObj.auto && <span style={{ fontSize:10, color:'#4ade80', background:'#14532d22', padding:'2px 6px', borderRadius:4 }}>auto</span>}
                  </div>
                  <div style={{ fontSize:14, color:C.text, fontWeight:500, marginBottom:3 }}>{s.assunto}</div>
                  <div style={{ fontSize:11, color:C.text3 }}>
                    {autor ? autor.nome : '—'} • {relTime(s.created_at)}
                  </div>
                </div>
                <span style={{ background:sc.bg, border:'1px solid '+sc.border, color:sc.text, padding:'4px 10px', borderRadius:9999, fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>{s.status}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* MODAL: Nova solicitação */}
      {showNova && (
        <div onClick={function(){ if(!saving) setShowNova(false) }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:12, padding:24, width:640, maxWidth:'95vw', maxHeight:'92vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em' }}>📨 Nova solicitação</div>
              <button onClick={function(){ if(!saving) setShowNova(false) }} style={{ background:'none', border:'none', color:'#7a6a4a', fontSize:20, cursor:'pointer' }}>×</button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
              <div>
                <label style={lbl}>Tipo</label>
                <select style={inputStyle} value={nova.tipo} onChange={function(e){ mudarTipo(e.target.value) }}>
                  {TIPOS.map(function(t){ return <option key={t.id} value={t.id}>{t.icon} {t.label}</option> })}
                </select>
              </div>
              <div>
                <label style={lbl}>Prioridade</label>
                <select style={inputStyle} value={nova.prioridade} onChange={function(e){ setNova(function(p){ return { ...p, prioridade: e.target.value } }) }}>
                  {PRIORIDADES.map(function(p){ return <option key={p.id} value={p.id}>{p.label}</option> })}
                </select>
              </div>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={lbl}>Assunto*</label>
              <input style={inputStyle} value={nova.assunto} onChange={function(e){ setNova(function(p){ return { ...p, assunto: e.target.value } }) }} placeholder="Resumo curto do pedido" />
            </div>

            {(TIPOS.find(function(t){ return t.id === nova.tipo }) || {}).auto && (
              <div style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:11, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10, fontWeight:600 }}>📋 Dados para cadastro automático</div>
                <PayloadForm tipo={nova.tipo} payload={nova.payload} onChange={function(p){ setNova(function(prev){ return { ...prev, payload: p } }) }} />
              </div>
            )}

            <div style={{ marginBottom:14 }}>
              <label style={lbl}>Mensagem / observações</label>
              <textarea style={{ ...inputStyle, resize:'vertical' }} rows={3} value={nova.descricao} onChange={function(e){ setNova(function(p){ return { ...p, descricao: e.target.value } }) }} placeholder="Detalhes adicionais ou contexto" />
            </div>

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button style={btnGhost} onClick={function(){ setShowNova(false) }} disabled={saving}>Cancelar</button>
              <button style={btnPrimary} onClick={criar} disabled={saving}>{saving ? 'Enviando…' : 'Enviar solicitação'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Detalhe (chat + aprovar) */}
      {aberta && (
        <div onClick={function(){ setAberta(null) }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:12, width:760, maxWidth:'95vw', height:'88vh', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'16px 22px', borderBottom:'1px solid #2a2415', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:4 }}>
                  {tipoAberta.icon} {tipoAberta.label}
                  {tipoAberta.auto && <span style={{ marginLeft:8, fontSize:10, color:'#4ade80', background:'#14532d22', padding:'2px 6px', borderRadius:4 }}>auto</span>}
                </div>
                <div style={{ fontSize:16, fontWeight:600, color:C.text }}>{aberta.assunto}</div>
                <div style={{ fontSize:11, color:C.text3, marginTop:4 }}>
                  Por {autoresMap[aberta.criado_por] ? autoresMap[aberta.criado_por].nome : '—'} • {fmtDate(aberta.created_at)}
                </div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {ehStaff && (
                  <select style={{ ...inputStyle, width:160 }} value={aberta.status} onChange={function(e){ mudarStatus(aberta, e.target.value) }}>
                    {['Pendente','Em andamento','Concluida','Cancelada'].map(function(s){ return <option key={s}>{s}</option> })}
                  </select>
                )}
                <button onClick={function(){ setAberta(null) }} style={{ background:'none', border:'none', color:'#7a6a4a', fontSize:24, cursor:'pointer' }}>×</button>
              </div>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:18, display:'flex', flexDirection:'column', gap:10, background:'#0a0900' }}>
              <PayloadView tipo={aberta.tipo} payload={aberta.payload} />

              {podeExecutar && (
                <div style={{ background:'#14532d11', border:'1px dashed #14532d', borderRadius:8, padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
                  <div>
                    <div style={{ fontSize:13, color:'#4ade80', fontWeight:600 }}>✓ Aprovar e executar automaticamente</div>
                    <div style={{ fontSize:11, color:C.text3, marginTop:3 }}>O sistema vai cadastrar os dados acima diretamente no CRM.</div>
                  </div>
                  <button style={btnAprovar} onClick={aprovarExecutar} disabled={executando}>{executando ? 'Executando…' : '✓ Aprovar e executar'}</button>
                </div>
              )}

              {aberta.status === 'Concluida' && aberta.resultado && (
                <div style={{ background:'#14532d22', border:'1px solid #14532d', borderRadius:8, padding:'10px 14px', color:'#4ade80', fontSize:12 }}>
                  ✅ Solicitação executada. Resultado: <code style={{ color:C.text }}>{JSON.stringify(aberta.resultado)}</code>
                </div>
              )}

              {mensagens.length === 0 && <div style={{ color:C.text3, fontStyle:'italic', textAlign:'center', padding:14 }}>Sem mensagens ainda.</div>}
              {mensagens.map(function(m) {
                var meu = m.autor_id === (auth.profile && auth.profile.id)
                return (
                  <div key={m.id} style={{ display:'flex', justifyContent: meu ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth:'80%', background: meu ? '#1c1810' : '#0d0b06', border:'1px solid '+(meu?'#2a2415':'#1c1810'), borderRadius:10, padding:'10px 14px' }}>
                      <div style={{ fontSize:11, color: meu ? C.gold : C.text2, fontWeight:600, marginBottom:4 }}>{m.autor_nome || '—'}</div>
                      <div style={{ fontSize:13, color:C.text, whiteSpace:'pre-wrap' }}>{m.texto}</div>
                      <div style={{ fontSize:10, color:C.text3, marginTop:6 }}>{relTime(m.created_at)}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ padding:'14px 18px', borderTop:'1px solid #2a2415', display:'flex', gap:10 }}>
              <textarea style={{ ...inputStyle, resize:'none', height:60 }}
                placeholder="Escreva uma mensagem..."
                value={novaMsg}
                onChange={function(e){ setNovaMsg(e.target.value) }}
                onKeyDown={function(e){ if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { enviarMsg() } }} />
              <button style={{ ...btnPrimary, alignSelf:'stretch', padding:'0 18px' }} onClick={enviarMsg} disabled={!novaMsg.trim()}>Enviar ▶</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
