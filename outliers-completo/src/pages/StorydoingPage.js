import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, formatTel, unformatTel, C } from '../lib/ui'

var SALA_C = {
  black: { bg: '#1c1c1c',   border: '#2a2415', text: '#f0ead8', label: '⚫ Black' },
  white: { bg: '#3a3320',   border: '#c9a96e', text: '#f0ead8', label: '⚪ White' },
}
var STATUS_C = {
  Pendente:   { bg: '#78350f22', border: '#78350f', text: '#fbbf24' },
  Pago:       { bg: '#14532d22', border: '#14532d', text: '#4ade80' },
  Cancelado:  { bg: '#1c1810',   border: '#2a2415', text: '#7a6a4a' },
  Reembolsado:{ bg: '#7f1d1d22', border: '#7f1d1d', text: '#fca5a5' },
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

function Card({ label, value, sub, color, icon }) {
  return (
    <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, padding:'18px 22px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em' }}>{label}</div>
        {icon && <div style={{ fontSize:18 }}>{icon}</div>}
      </div>
      <div style={{ fontSize:24, fontWeight:700, color: color || '#f0ead8', marginTop:4 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#7a6a4a', marginTop:4 }}>{sub}</div>}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>{label}</label>
      {children}
    </div>
  )
}

function emptyForm() {
  return {
    sala:'black', data_locacao:'', data_fim:'', hora_inicio:'', hora_fim:'', valor:'',
    locador_nome:'', locador_telefone:'', locador_email:'', locador_documento:'',
    responsavel_id:'', comissao_percentual:'',
    num_parcelas: 1,
    parcelas: [ { numero:1, valor:'', forma_pagamento:'PIX', vencimento:'', status:'Pendente', pago_em:'', comprovante_file:null } ],
    observacoes:'',
  }
}

function distribuirParcelas(valorTotal, n, primeiraData) {
  if (!n || n < 1) n = 1
  var c = Math.round(Number(valorTotal||0) * 100)
  var unit = Math.floor(c / n) / 100
  var ultima = (c - Math.floor(c / n) * (n - 1)) / 100
  var arr = []
  var base = primeiraData ? new Date(primeiraData + 'T00:00:00') : new Date()
  for (var i = 0; i < n; i++) {
    var d = new Date(base.getTime())
    var diaAlvo = base.getDate()
    d.setDate(1); d.setMonth(d.getMonth() + i)
    var ult = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
    d.setDate(Math.min(diaAlvo, ult))
    arr.push({
      numero: i+1,
      valor: (i === n-1 ? ultima : unit).toFixed(2),
      forma_pagamento: i === 0 ? 'PIX' : 'Cartão',
      vencimento: d.toISOString().slice(0,10),
      status: 'Pendente', pago_em: '', comprovante_file: null,
    })
  }
  return arr
}

export default function StorydoingPage() {
  var auth = useAuth()
  var podeEditar = auth.isAdmin || auth.isFinanceiro || auth.isComercial
  var podeExcluir = auth.isAdmin || auth.isFinanceiro

  var [locacoes, setLocacoes] = useState([])
  var [pessoas, setPessoas] = useState([])
  var [loading, setLoading] = useState(true)
  var [filtroSala, setFiltroSala] = useState('Todas')
  var [filtroStatus, setFiltroStatus] = useState('Todos')
  var [filtroMes, setFiltroMes] = useState('todos')
  var [search, setSearch] = useState('')

  var [showModal, setShowModal] = useState(false)
  var [editing, setEditing] = useState(null)
  var [form, setForm] = useState(emptyForm())
  var [saving, setSaving] = useState(false)

  async function carregar() {
    setLoading(true)
    var [rl, rp, rparc] = await Promise.all([
      supabase.from('storydoing_locacoes').select('*').order('data_locacao', { ascending: false }),
      supabase.from('profiles').select('id,nome,role').order('nome'),
      supabase.from('storydoing_parcelas').select('*'),
    ])
    var parcelasMap = {}
    ;(rparc.data || []).forEach(function(p) {
      if (!parcelasMap[p.locacao_id]) parcelasMap[p.locacao_id] = []
      parcelasMap[p.locacao_id].push(p)
    })
    var enriquecidas = (rl.data || []).map(function(l) {
      var parcelas = parcelasMap[l.id] || []
      var valorRecebido, qtdPagas, qtdTotal, formaResumo
      if (parcelas.length > 0) {
        valorRecebido = parcelas.filter(function(x){return x.status==='Pago'}).reduce(function(s,x){ return s + Number(x.valor||0) }, 0)
        qtdPagas = parcelas.filter(function(x){return x.status==='Pago'}).length
        qtdTotal = parcelas.length
        var formas = Array.from(new Set(parcelas.map(function(x){return x.forma_pagamento}).filter(Boolean)))
        formaResumo = formas.length === 1 ? formas[0] : (formas.length > 1 ? formas.join('+') : null)
      } else {
        // Compat com locacoes antigas (sem parcelas)
        valorRecebido = l.status_pagamento === 'Pago' ? Number(l.valor||0) : 0
        qtdPagas = l.status_pagamento === 'Pago' ? 1 : 0
        qtdTotal = 1
        formaResumo = l.forma_pagamento
      }
      var comissaoTotal = Number(l.comissao_valor||0)
      var comissaoLiberada = Number(l.valor) > 0 ? Math.round((comissaoTotal * valorRecebido / Number(l.valor)) * 100) / 100 : 0
      var comissaoAPagar = comissaoLiberada - (l.comissao_paga ? comissaoTotal : 0)
      if (comissaoAPagar < 0) comissaoAPagar = 0
      return {
        ...l,
        _parcelas: parcelas,
        _valor_recebido: valorRecebido,
        _valor_pendente: Number(l.valor||0) - valorRecebido,
        _qtd_pagas: qtdPagas,
        _qtd_total: qtdTotal,
        _forma_resumo: formaResumo,
        _comissao_liberada: comissaoLiberada,
        _comissao_a_pagar: comissaoAPagar,
      }
    })
    setLocacoes(enriquecidas)
    setPessoas(rp.data || [])
    setLoading(false)
  }
  useEffect(function(){ carregar() }, [])

  function abrirNova() {
    setEditing(null)
    var hoje = new Date().toISOString().slice(0,10)
    setForm({ ...emptyForm(), data_locacao: hoje, parcelas: [ { numero:1, valor:'', forma_pagamento:'PIX', vencimento: hoje, status:'Pendente', pago_em:'', comprovante_file:null } ] })
    setShowModal(true)
  }
  async function abrirEdicao(l) {
    setEditing(l)
    // Busca parcelas existentes desta locacao
    var rp = await supabase.from('storydoing_parcelas').select('*').eq('locacao_id', l.id).order('numero')
    var parcelasDb = rp.data || []
    var parcelasForm
    if (parcelasDb.length === 0) {
      // Sem parcelas registradas -> migra a forma antiga (1 parcela só)
      parcelasForm = [{
        numero: 1,
        valor: String(l.valor || ''),
        forma_pagamento: l.forma_pagamento || '',
        vencimento: l.data_pagamento || l.data_locacao || '',
        status: l.status_pagamento || 'Pendente',
        pago_em: l.data_pagamento ? String(l.data_pagamento).slice(0,10) : '',
        comprovante_file: null,
        _comprovante_url_atual: l.comprovante_url,
        _comprovante_nome_atual: l.comprovante_nome,
      }]
    } else {
      parcelasForm = parcelasDb.map(function(p){
        return {
          id: p.id,
          numero: p.numero,
          valor: String(p.valor || ''),
          forma_pagamento: p.forma_pagamento || '',
          vencimento: p.vencimento ? String(p.vencimento).slice(0,10) : '',
          status: p.status || 'Pendente',
          pago_em: p.pago_em ? String(p.pago_em).slice(0,10) : '',
          comprovante_file: null,
          _comprovante_url_atual: p.comprovante_url,
          _comprovante_nome_atual: p.comprovante_nome,
        }
      })
    }
    setForm({
      sala: l.sala || 'black',
      data_locacao: l.data_locacao ? String(l.data_locacao).slice(0,10) : '',
      data_fim: l.data_fim ? String(l.data_fim).slice(0,10) : '',
      hora_inicio: l.hora_inicio || '',
      hora_fim: l.hora_fim || '',
      valor: String(l.valor || ''),
      locador_nome: l.locador_nome || '',
      locador_telefone: l.locador_telefone || '',
      locador_email: l.locador_email || '',
      locador_documento: l.locador_documento || '',
      responsavel_id: l.responsavel_id || '',
      comissao_percentual: String(l.comissao_percentual || ''),
      num_parcelas: parcelasForm.length || 1,
      parcelas: parcelasForm,
      observacoes: l.observacoes || '',
    })
    setShowModal(true)
  }

  function setNumParcelas(n) {
    setForm(function(p) {
      var valTotal = Number(String(p.valor || '').replace(',','.')) || 0
      var primeira = (p.parcelas[0] && p.parcelas[0].vencimento) || p.data_locacao || new Date().toISOString().slice(0,10)
      var nova = distribuirParcelas(valTotal, n, primeira)
      return { ...p, num_parcelas: n, parcelas: nova }
    })
  }

  function updateParcela(i, field, value) {
    setForm(function(p) {
      var arr = p.parcelas.slice()
      arr[i] = { ...arr[i], [field]: value }
      // se mudar status pra Pago e nao tem pago_em, preenche com hoje
      if (field === 'status' && value === 'Pago' && !arr[i].pago_em) {
        arr[i].pago_em = new Date().toISOString().slice(0,10)
      }
      return { ...p, parcelas: arr }
    })
  }

  async function uploadComprovante(file) {
    if (!file) return null
    var ext = file.name.split('.').pop()
    var path = 'comprovantes/' + Date.now() + '_' + Math.random().toString(36).slice(2,8) + '.' + ext
    var up = await supabase.storage.from('storydoing-comprovantes').upload(path, file, { upsert: false })
    if (up.error) throw new Error('Erro upload: ' + up.error.message)
    return { url: path, nome: file.name }
  }

  async function salvar() {
    if (!form.locador_nome.trim()) { alert('Nome do locador é obrigatório.'); return }
    if (!form.data_locacao) { alert('Data da locação é obrigatória.'); return }
    var v = Number(String(form.valor||'').replace(',','.'))
    if (isNaN(v) || v <= 0) { alert('Valor da locação inválido.'); return }
    var pct = form.comissao_percentual ? Number(String(form.comissao_percentual).replace(',','.')) : 0
    if (isNaN(pct) || pct < 0 || pct > 100) { alert('Comissão % inválida (0-100).'); return }

    // Valida parcelas
    if (!form.parcelas || form.parcelas.length === 0) { alert('Cadastre ao menos 1 parcela.'); return }
    var somaParcelas = form.parcelas.reduce(function(s,p){ return s + Number(String(p.valor||'').replace(',','.')) }, 0)
    if (Math.abs(somaParcelas - v) > 0.05) {
      if (!window.confirm('A soma das parcelas (R$ ' + somaParcelas.toFixed(2) + ') não bate com o valor total (R$ ' + v.toFixed(2) + '). Salvar mesmo assim?')) return
    }

    setSaving(true)
    try {
      var responsavel_nome = null
      if (form.responsavel_id) {
        var pp = pessoas.find(function(x){ return x.id === form.responsavel_id })
        responsavel_nome = pp && pp.nome
      }

      // Status agregado da locacao
      var todasPagas = form.parcelas.every(function(p){ return p.status === 'Pago' })
      var statusLoc = todasPagas ? 'Pago' : 'Pendente'

      var payload = {
        sala: form.sala,
        data_locacao: form.data_locacao,
        data_fim: form.data_fim || null,
        hora_inicio: form.hora_inicio || null,
        hora_fim: form.hora_fim || null,
        valor: v,
        locador_nome: form.locador_nome.trim(),
        locador_telefone: unformatTel(form.locador_telefone) || null,
        locador_email: form.locador_email.trim() || null,
        locador_documento: form.locador_documento.trim() || null,
        responsavel_id: form.responsavel_id || null,
        responsavel_nome: responsavel_nome,
        comissao_percentual: pct,
        forma_pagamento: form.parcelas.length > 1 ? 'Parcelado' : (form.parcelas[0] && form.parcelas[0].forma_pagamento) || null,
        data_pagamento: form.parcelas[0] && form.parcelas[0].pago_em || null,
        status_pagamento: statusLoc,
        observacoes: form.observacoes.trim() || null,
      }
      if (!editing) payload.criado_por = auth.profile && auth.profile.id

      var locacaoId
      if (editing) {
        var r = await supabase.from('storydoing_locacoes').update(payload).eq('id', editing.id)
        if (r.error) { alert('Erro: ' + r.error.message); setSaving(false); return }
        locacaoId = editing.id
      } else {
        var r2 = await supabase.from('storydoing_locacoes').insert(payload).select().single()
        if (r2.error) { alert('Erro: ' + r2.error.message); setSaving(false); return }
        locacaoId = r2.data.id
      }

      // Persiste parcelas: deleta as antigas (se editando) e insere todas
      if (editing) {
        await supabase.from('storydoing_parcelas').delete().eq('locacao_id', locacaoId)
      }
      var rowsParc = []
      for (var i = 0; i < form.parcelas.length; i++) {
        var p = form.parcelas[i]
        var pVal = Number(String(p.valor||'').replace(',','.'))
        var compr = { url: p._comprovante_url_atual || null, nome: p._comprovante_nome_atual || null }
        if (p.comprovante_file) {
          try { compr = await uploadComprovante(p.comprovante_file) } catch(e) { alert(e.message); setSaving(false); return }
        }
        rowsParc.push({
          locacao_id: locacaoId,
          numero: p.numero || (i+1),
          valor: pVal,
          vencimento: p.vencimento || null,
          status: p.status || 'Pendente',
          pago_em: (p.status === 'Pago' && p.pago_em) ? p.pago_em : null,
          forma_pagamento: p.forma_pagamento || null,
          comprovante_url: compr.url,
          comprovante_nome: compr.nome,
        })
      }
      if (rowsParc.length) {
        var ip = await supabase.from('storydoing_parcelas').insert(rowsParc)
        if (ip.error) { alert('Erro ao salvar parcelas: ' + ip.error.message); setSaving(false); return }
      }

      setShowModal(false); setEditing(null); setForm(emptyForm())
      carregar()
    } catch (e) { alert('Erro: ' + (e.message || e)) }
    setSaving(false)
  }

  async function pagar(l) {
    if (l.status_pagamento === 'Pago') return
    var hoje = new Date().toISOString().slice(0,10)
    var data = window.prompt('Data do recebimento:', hoje)
    if (!data) return
    var r = await supabase.from('storydoing_locacoes').update({
      status_pagamento: 'Pago', data_pagamento: data,
    }).eq('id', l.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    carregar()
  }

  async function marcarComissaoPaga(l) {
    if (l.comissao_paga) {
      if (!window.confirm('Reverter pagamento da comissão?')) return
      var r = await supabase.from('storydoing_locacoes').update({ comissao_paga: false, comissao_paga_em: null }).eq('id', l.id)
      if (r.error) { alert('Erro: ' + r.error.message); return }
    } else {
      var hoje = new Date().toISOString().slice(0,10)
      var data = window.prompt('Data do pagamento da comissão para ' + (l.responsavel_nome || 'responsável') + ' (R$ ' + Number(l.comissao_valor||0).toFixed(2) + '):', hoje)
      if (!data) return
      var r2 = await supabase.from('storydoing_locacoes').update({ comissao_paga: true, comissao_paga_em: data }).eq('id', l.id)
      if (r2.error) { alert('Erro: ' + r2.error.message); return }
    }
    carregar()
  }

  async function excluir(l) {
    if (!window.confirm('Excluir esta locação? Não pode ser desfeito.')) return
    if (l.comprovante_url) {
      try { await supabase.storage.from('storydoing-comprovantes').remove([l.comprovante_url]) } catch(_e){}
    }
    var r = await supabase.from('storydoing_locacoes').delete().eq('id', l.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    carregar()
  }

  async function abrirComprovante(path) {
    if (!path) return
    var r = await supabase.storage.from('storydoing-comprovantes').createSignedUrl(path, 600) // 10 min
    if (r.error) { alert('Erro: ' + r.error.message); return }
    window.open(r.data.signedUrl, '_blank')
  }

  // Filtros
  function ymOf(d) { return d ? String(d).slice(0,7) : '' }
  var hoje = new Date()
  var ymAtual = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0')
  var mesesUnicos = Array.from(new Set(locacoes.map(function(l){ return ymOf(l.data_locacao) }).filter(Boolean))).sort().reverse()

  var filtradas = locacoes.filter(function(l) {
    if (filtroSala !== 'Todas' && l.sala !== filtroSala) return false
    if (filtroStatus !== 'Todos' && l.status_pagamento !== filtroStatus) return false
    if (filtroMes === 'atual' && ymOf(l.data_locacao) !== ymAtual) return false
    else if (filtroMes !== 'todos' && filtroMes !== 'atual' && ymOf(l.data_locacao) !== filtroMes) return false
    if (search) {
      var s = search.toLowerCase()
      if (!(l.locador_nome||'').toLowerCase().includes(s)
       && !(l.responsavel_nome||'').toLowerCase().includes(s)
       && !(l.observacoes||'').toLowerCase().includes(s)) return false
    }
    return true
  })

  var totalRecebido = filtradas.reduce(function(s,l){ return s + Number(l._valor_recebido||0) }, 0)
  var totalPendente = filtradas.reduce(function(s,l){ return s + Number(l._valor_pendente||0) }, 0)
  var totalBlack = filtradas.filter(function(l){ return l.sala === 'black' }).reduce(function(s,l){ return s + Number(l.valor) }, 0)
  var totalWhite = filtradas.filter(function(l){ return l.sala === 'white' }).reduce(function(s,l){ return s + Number(l.valor) }, 0)
  // Comissão liberada = proporcional ao recebido (em todas as parcelas pagas)
  var comissaoPagar = filtradas.reduce(function(s,l){ return s + Number(l._comissao_a_pagar||0) }, 0)
  var comissaoPaga  = filtradas.filter(function(l){ return l.comissao_paga }).reduce(function(s,l){ return s + Number(l.comissao_valor||0) }, 0)

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>Storydoing — Locações</div>
          <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Locações das salas Black e White com responsável, comissão e comprovante.</div>
        </div>
        {podeEditar && <button style={btnPrimary} onClick={abrirNova}>+ Nova locação</button>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:14 }}>
        <Card label="Recebido" value={fmt(totalRecebido)} sub={filtradas.filter(function(l){return l.status_pagamento==='Pago'}).length + ' locação(ões)'} icon="✅" color="#4ade80" />
        <Card label="A receber" value={fmt(totalPendente)} sub="aguardando pagamento" icon="⏳" color={C.gold} />
        <Card label="Sala Black" value={fmt(totalBlack)} sub={filtradas.filter(function(l){return l.sala==='black'}).length + ' locação(ões)'} icon="⚫" />
        <Card label="Sala White" value={fmt(totalWhite)} sub={filtradas.filter(function(l){return l.sala==='white'}).length + ' locação(ões)'} icon="⚪" color="#a78bfa" />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:14, marginBottom:20 }}>
        <Card label="Comissão a pagar" value={fmt(comissaoPagar)} sub="responsáveis pelas locações" icon="🤝" color={C.gold} />
        <Card label="Comissão paga" value={fmt(comissaoPaga)} sub="já transferida" icon="📤" color="#4ade80" />
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <input style={{ ...inputStyle, flex:'1 1 200px', minWidth:160 }} placeholder="Buscar locador, responsável..." value={search} onChange={function(e){ setSearch(e.target.value) }} />
        <select style={{ ...inputStyle, width:140 }} value={filtroSala} onChange={function(e){ setFiltroSala(e.target.value) }}>
          <option>Todas</option><option value="black">Sala Black</option><option value="white">Sala White</option>
        </select>
        <select style={{ ...inputStyle, width:160 }} value={filtroStatus} onChange={function(e){ setFiltroStatus(e.target.value) }}>
          {['Todos','Pendente','Pago','Cancelado','Reembolsado'].map(function(s){ return <option key={s}>{s}</option> })}
        </select>
        <select style={{ ...inputStyle, width:170 }} value={filtroMes} onChange={function(e){ setFiltroMes(e.target.value) }}>
          <option value="todos">📅 Todos os meses</option>
          <option value="atual">Mês atual</option>
          <option disabled>──────────</option>
          {mesesUnicos.map(function(m){ return <option key={m} value={m}>{m}</option> })}
        </select>
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:24, color:C.text3, fontStyle:'italic' }}>Carregando...</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding:30, color:C.text3, fontStyle:'italic', textAlign:'center' }}>Nenhuma locação encontrada.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#0d0b06' }}>
                {['Data','Sala','Locador','Valor','Responsável','Comissão','Forma','Status','Compr.','Ações'].map(function(h,i){
                  return <th key={i} style={{ textAlign:'left', padding:'10px 12px', fontSize:10, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {filtradas.map(function(l) {
                var sc = SALA_C[l.sala] || SALA_C.black
                var sp = STATUS_C[l.status_pagamento] || STATUS_C.Pendente
                return (
                  <tr key={l.id} style={{ borderTop:'1px solid #1c1810' }}>
                    <td style={{ padding:'10px 12px', color:C.text2, fontFamily:'monospace', whiteSpace:'nowrap' }}>
                      {fmtDate(l.data_locacao)}
                      {l.hora_inicio && <span style={{ color:C.text3 }}> {String(l.hora_inicio).slice(0,5)}</span>}
                      {l.data_fim && l.data_fim !== l.data_locacao && (
                        <div style={{ fontSize:10, color:C.text3 }}>→ {fmtDate(l.data_fim)}</div>
                      )}
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      <span style={{ background:sc.bg, border:'1px solid '+sc.border, color:sc.text, padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>{sc.label}</span>
                    </td>
                    <td style={{ padding:'10px 12px', color:C.text }}>
                      <div style={{ fontWeight:500 }}>{l.locador_nome}</div>
                      {l.locador_telefone && <div style={{ fontSize:11, color:C.text3 }}>{formatTel(l.locador_telefone)}</div>}
                    </td>
                    <td style={{ padding:'10px 12px', fontWeight:600, color:C.text }}>
                      <div>{fmt(l.valor)}</div>
                      {l._qtd_total > 1 && <div style={{ fontSize:10, color:C.text3, fontWeight:400 }}>{l._qtd_pagas}/{l._qtd_total} pagas · {fmt(l._valor_recebido)} recebido</div>}
                    </td>
                    <td style={{ padding:'10px 12px', color:C.text2 }}>{l.responsavel_nome || '—'}</td>
                    <td style={{ padding:'10px 12px' }}>
                      {Number(l.comissao_valor||0) > 0 ? (
                        <div>
                          <div style={{ color: l.comissao_paga ? '#4ade80' : C.gold, fontWeight:600 }}>{fmt(l.comissao_valor)} {l.comissao_paga && '✓'}</div>
                          <div style={{ fontSize:10, color:C.text3 }}>{Number(l.comissao_percentual).toFixed(2)}% · liberado: {fmt(l._comissao_liberada)}</div>
                        </div>
                      ) : <span style={{ color:C.text3 }}>—</span>}
                    </td>
                    <td style={{ padding:'10px 12px', color:C.text2, fontSize:12 }}>{l._forma_resumo || '—'}</td>
                    <td style={{ padding:'10px 12px' }}>
                      <span style={{ background:sp.bg, border:'1px solid '+sp.border, color:sp.text, padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>{l.status_pagamento}</span>
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      {l.comprovante_url ? (
                        <button onClick={function(){ abrirComprovante(l.comprovante_url) }} style={{ ...btnGhost, padding:'4px 8px', fontSize:11 }}>📄 ver</button>
                      ) : <span style={{ color:C.text3, fontSize:11 }}>—</span>}
                    </td>
                    <td style={{ padding:'10px 12px', whiteSpace:'nowrap' }}>
                      {podeEditar && l.status_pagamento !== 'Pago' && (
                        <button style={{ ...btnGhost, color:'#4ade80', borderColor:'#14532d', marginRight:4, padding:'4px 8px', fontSize:11 }} onClick={function(){ pagar(l) }}>✓ Receber</button>
                      )}
                      {podeEditar && Number(l.comissao_valor||0) > 0 && (
                        <button style={{ ...btnGhost, marginRight:4, padding:'4px 8px', fontSize:11, color: l.comissao_paga ? '#7a6a4a' : C.gold }} onClick={function(){ marcarComissaoPaga(l) }}>{l.comissao_paga ? 'Reverter' : '💸 Comissão'}</button>
                      )}
                      {podeEditar && (
                        <button style={{ ...btnGhost, marginRight:4, padding:'4px 8px', fontSize:11 }} onClick={function(){ abrirEdicao(l) }}>✎</button>
                      )}
                      {podeExcluir && (
                        <button style={{ ...btnGhost, color:'#fca5a5', borderColor:'#7f1d1d', padding:'4px 8px', fontSize:11 }} onClick={function(){ excluir(l) }}>🗑️</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL */}
      {showModal && (
        <div onClick={function(){ if(!saving) setShowModal(false) }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:12, padding:24, width:680, maxWidth:'95vw', maxHeight:'92vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em' }}>{editing ? 'Editar locação' : 'Nova locação'}</div>
              <button onClick={function(){ if(!saving) setShowModal(false) }} style={{ background:'none', border:'none', color:'#7a6a4a', fontSize:20, cursor:'pointer' }}>×</button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Sala*">
                <select style={inputStyle} value={form.sala} onChange={function(e){ setForm(function(p){ return { ...p, sala: e.target.value } }) }}>
                  <option value="black">⚫ Black</option>
                  <option value="white">⚪ White</option>
                </select>
              </Field>
              <Field label="Valor (R$)*">
                <input type="number" step="0.01" style={inputStyle} value={form.valor} onChange={function(e){ setForm(function(p){ return { ...p, valor: e.target.value } }) }} placeholder="0,00" />
              </Field>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
              <Field label="Data início*">
                <input type="date" style={inputStyle} value={form.data_locacao} onChange={function(e){ setForm(function(p){ return { ...p, data_locacao: e.target.value } }) }} />
              </Field>
              <Field label="Data fim">
                <input type="date" style={inputStyle} value={form.data_fim} onChange={function(e){ setForm(function(p){ return { ...p, data_fim: e.target.value } }) }} />
              </Field>
              <Field label="Hora início">
                <input type="time" style={inputStyle} value={form.hora_inicio} onChange={function(e){ setForm(function(p){ return { ...p, hora_inicio: e.target.value } }) }} />
              </Field>
              <Field label="Hora fim">
                <input type="time" style={inputStyle} value={form.hora_fim} onChange={function(e){ setForm(function(p){ return { ...p, hora_fim: e.target.value } }) }} />
              </Field>
            </div>
            {form.data_locacao && form.data_fim && (function(){
              var d1 = new Date(form.data_locacao + 'T00:00:00')
              var d2 = new Date(form.data_fim + 'T00:00:00')
              var dias = Math.round((d2 - d1) / 86400000) + 1
              if (dias < 1) return <div style={{ fontSize:11, color:'#fca5a5', marginBottom:8 }}>⚠️ Data fim anterior à data início</div>
              return <div style={{ fontSize:11, color:C.text3, marginBottom:8 }}>📅 Período: <strong style={{ color:C.gold }}>{dias} dia{dias>1?'s':''}</strong></div>
            })()}

            <div style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
              <div style={{ fontSize:11, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10, fontWeight:600 }}>Locador (cliente que alugou)</div>
              <Field label="Nome do locador*">
                <input style={inputStyle} value={form.locador_nome} onChange={function(e){ setForm(function(p){ return { ...p, locador_nome: e.target.value } }) }} />
              </Field>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                <Field label="Telefone">
                  <input style={inputStyle} value={form.locador_telefone} onChange={function(e){ setForm(function(p){ return { ...p, locador_telefone: e.target.value } }) }} placeholder="(11) 98765-4321" />
                </Field>
                <Field label="E-mail">
                  <input type="email" style={inputStyle} value={form.locador_email} onChange={function(e){ setForm(function(p){ return { ...p, locador_email: e.target.value } }) }} />
                </Field>
                <Field label="CPF/CNPJ">
                  <input style={inputStyle} value={form.locador_documento} onChange={function(e){ setForm(function(p){ return { ...p, locador_documento: e.target.value } }) }} />
                </Field>
              </div>
            </div>

            <div style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
              <div style={{ fontSize:11, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10, fontWeight:600 }}>Responsável + comissão</div>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12 }}>
                <Field label="Responsável pela locação">
                  <select style={inputStyle} value={form.responsavel_id} onChange={function(e){ setForm(function(p){ return { ...p, responsavel_id: e.target.value } }) }}>
                    <option value="">— sem comissão —</option>
                    {pessoas.map(function(p){ return <option key={p.id} value={p.id}>{p.nome} {p.role ? '('+p.role+')' : ''}</option> })}
                  </select>
                </Field>
                <Field label="Comissão (%)">
                  <input type="number" step="0.5" min="0" max="100" style={inputStyle} value={form.comissao_percentual} onChange={function(e){ setForm(function(p){ return { ...p, comissao_percentual: e.target.value } }) }} placeholder="ex: 10" />
                </Field>
              </div>
              {(function(){
                var pct = Number(String(form.comissao_percentual||'').replace(',','.'))
                var val = Number(String(form.valor||'').replace(',','.'))
                if (isNaN(pct) || isNaN(val) || pct <= 0 || val <= 0) return null
                return <div style={{ fontSize:12, color:C.gold }}>Comissão calculada: <strong>{fmt(val * pct / 100)}</strong></div>
              })()}
            </div>

            <div style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:8, padding:'12px 14px', marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontSize:11, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600 }}>Pagamento</div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:11, color:C.text3 }}>Parcelas:</span>
                  <select style={{ ...inputStyle, width:80, padding:'4px 8px' }} value={form.num_parcelas} onChange={function(e){ setNumParcelas(parseInt(e.target.value, 10)) }}>
                    {[1,2,3,4,5,6,7,8,9,10,12].map(function(n){ return <option key={n} value={n}>{n}x</option> })}
                  </select>
                </div>
              </div>

              {form.parcelas.map(function(p, i) {
                var bg = p.status === 'Pago' ? '#14532d22' : p.status === 'Atrasado' ? '#7f1d1d22' : '#1c1810'
                var border = p.status === 'Pago' ? '#14532d' : p.status === 'Atrasado' ? '#7f1d1d' : '#2a2415'
                return (
                  <div key={i} style={{ background:bg, border:'1px solid '+border, borderRadius:6, padding:'10px 12px', marginBottom:8 }}>
                    <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 1fr 1fr 1fr', gap:8, alignItems:'flex-end' }}>
                      <div>
                        <div style={{ fontSize:10, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>#</div>
                        <div style={{ fontSize:14, fontWeight:600, color:C.gold, padding:'8px 0' }}>{p.numero}</div>
                      </div>
                      <Field label="Valor (R$)">
                        <input type="number" step="0.01" style={inputStyle} value={p.valor} onChange={function(e){ updateParcela(i, 'valor', e.target.value) }} />
                      </Field>
                      <Field label="Forma">
                        <select style={inputStyle} value={p.forma_pagamento} onChange={function(e){ updateParcela(i, 'forma_pagamento', e.target.value) }}>
                          <option value="">—</option>
                          <option>PIX</option>
                          <option>Cartão</option>
                          <option>Boleto</option>
                          <option>Dinheiro</option>
                          <option>Transferência</option>
                        </select>
                      </Field>
                      <Field label="Vencimento">
                        <input type="date" style={inputStyle} value={p.vencimento} onChange={function(e){ updateParcela(i, 'vencimento', e.target.value) }} />
                      </Field>
                      <Field label="Status">
                        <select style={inputStyle} value={p.status} onChange={function(e){ updateParcela(i, 'status', e.target.value) }}>
                          {['Pendente','Pago','Atrasado','Cancelado'].map(function(s){ return <option key={s}>{s}</option> })}
                        </select>
                      </Field>
                    </div>
                    {p.status === 'Pago' && (
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:8, marginTop:6 }}>
                        <Field label="Pago em">
                          <input type="date" style={inputStyle} value={p.pago_em} onChange={function(e){ updateParcela(i, 'pago_em', e.target.value) }} />
                        </Field>
                        <Field label="Comprovante (PDF/JPG/PNG)">
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                                 onChange={function(e){ var f = e.target.files && e.target.files[0]; if (f && f.size > 10*1024*1024) { alert('Arquivo maior que 10MB'); return } updateParcela(i, 'comprovante_file', f) }}
                                 style={{ ...inputStyle, padding:'6px 8px', fontSize:12 }} />
                          {p._comprovante_url_atual && !p.comprovante_file && (
                            <div style={{ fontSize:10, color:C.text3, marginTop:4 }}>📎 {p._comprovante_nome_atual || 'comprovante atual'}{' '}<button type="button" onClick={function(){ abrirComprovante(p._comprovante_url_atual) }} style={{ ...btnGhost, padding:'1px 6px', fontSize:10, marginLeft:6 }}>ver</button></div>
                          )}
                          {p.comprovante_file && <div style={{ fontSize:10, color:'#4ade80', marginTop:4 }}>✓ {p.comprovante_file.name}</div>}
                        </Field>
                      </div>
                    )}
                  </div>
                )
              })}

              {(function() {
                var soma = form.parcelas.reduce(function(s,p){ return s + Number(String(p.valor||'').replace(',','.') || 0) }, 0)
                var total = Number(String(form.valor||'').replace(',','.') || 0)
                var diff = total - soma
                if (Math.abs(diff) < 0.01) return <div style={{ fontSize:11, color:'#4ade80', marginTop:4 }}>✓ Soma das parcelas confere com o valor total</div>
                return <div style={{ fontSize:11, color:'#fca5a5', marginTop:4 }}>⚠️ Soma das parcelas: {fmt(soma)} · Diferença: {fmt(diff)}</div>
              })()}
            </div>

            <Field label="Observações">
              <textarea style={{ ...inputStyle, resize:'vertical' }} rows={2} value={form.observacoes} onChange={function(e){ setForm(function(p){ return { ...p, observacoes: e.target.value } }) }} />
            </Field>

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
              <button style={btnGhost} onClick={function(){ setShowModal(false) }} disabled={saving}>Cancelar</button>
              <button style={btnPrimary} onClick={salvar} disabled={saving}>{saving ? 'Salvando…' : (editing ? 'Salvar alterações' : 'Criar locação')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
