import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, C } from '../lib/ui'
import StorydoingPage  from './StorydoingPage'
import ContasPagarPage from './ContasPagarPage'

function Tab({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? '#141209' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #c9a96e' : '2px solid transparent',
        color: active ? '#c9a96e' : '#7a6a4a',
        padding: '12px 18px',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'Inter,sans-serif',
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: -1,
      }}>
      {icon && <span>{icon}</span>}
      {children}
    </button>
  )
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

var inputStyle = {
  background:'#0a0900', border:'1px solid #2a2415', borderRadius:6,
  padding:'8px 12px', color:'#f0ead8', fontSize:13, fontFamily:'Inter,sans-serif', outline:'none',
}

function ymd(d){ return d.toISOString().slice(0,10) }
function inicioMes(d){ return ymd(new Date(d.getFullYear(), d.getMonth(), 1)) }
function fimMes(d){ return ymd(new Date(d.getFullYear(), d.getMonth()+1, 0)) }

// DRE específica do Storydoing
function StorydoingDRE() {
  var hoje = new Date()
  var [periodo, setPeriodo] = useState('mes_atual')
  var [dtIni, setDtIni] = useState(inicioMes(hoje))
  var [dtFim, setDtFim] = useState(fimMes(hoje))
  var [locacoes, setLocacoes] = useState([])
  var [contas, setContas] = useState([])
  var [comissoes, setComissoes] = useState([])
  var [loading, setLoading] = useState(true)

  useEffect(function() {
    var d = new Date()
    if (periodo === 'mes_atual') { setDtIni(inicioMes(d)); setDtFim(fimMes(d)) }
    else if (periodo === 'mes_anterior') {
      var ant = new Date(d.getFullYear(), d.getMonth()-1, 15)
      setDtIni(inicioMes(ant)); setDtFim(fimMes(ant))
    }
    else if (periodo === 'trimestre') {
      var ini = new Date(d.getFullYear(), d.getMonth()-2, 1)
      setDtIni(ymd(ini)); setDtFim(fimMes(d))
    }
    else if (periodo === 'ano') {
      setDtIni(d.getFullYear() + '-01-01'); setDtFim(d.getFullYear() + '-12-31')
    }
  }, [periodo])

  useEffect(function() { carregar() }, [dtIni, dtFim])

  async function carregar() {
    setLoading(true)
    // Receita = parcelas storydoing pagas no periodo + (compat) locacoes sem parcelas com data_pagamento no periodo
    var [rparc, rlocSemParc, rc, rcom] = await Promise.all([
      supabase.from('storydoing_parcelas')
        .select('id,valor,pago_em,locacao:locacao_id(sala)')
        .eq('status', 'Pago')
        .gte('pago_em', dtIni).lte('pago_em', dtFim),
      // locacoes pagas sem parcelas (legado)
      supabase.from('storydoing_locacoes')
        .select('id,sala,valor,data_pagamento')
        .eq('status_pagamento', 'Pago')
        .gte('data_pagamento', dtIni).lte('data_pagamento', dtFim),
      supabase.from('contas_pagar').select('id,descricao,categoria,valor,pago_em')
        .eq('status', 'Pago').eq('origem', 'Storydoing')
        .gte('pago_em', dtIni).lte('pago_em', dtFim),
      supabase.from('storydoing_locacoes').select('id,comissao_valor,comissao_paga_em,responsavel_nome')
        .eq('comissao_paga', true)
        .gte('comissao_paga_em', dtIni).lte('comissao_paga_em', dtFim),
    ])
    // Combina: prioriza parcelas. Filtra locacoes legadas que ja têm parcelas
    var locsComParcela = new Set((rparc.data || []).map(function(p){ return p.locacao && p.locacao.id }))
    var legadas = (rlocSemParc.data || []).filter(function(l){ return !locsComParcela.has(l.id) })
    var receitas = []
    ;(rparc.data || []).forEach(function(p) {
      receitas.push({ id: 'p_'+p.id, valor: p.valor, sala: p.locacao && p.locacao.sala })
    })
    legadas.forEach(function(l) {
      receitas.push({ id: 'l_'+l.id, valor: l.valor, sala: l.sala })
    })
    setLocacoes(receitas)
    setContas(rc.data || [])
    setComissoes(rcom.data || [])
    setLoading(false)
  }

  var totBlack = locacoes.filter(function(l){ return l.sala === 'black' }).reduce(function(s,l){ return s + Number(l.valor||0) }, 0)
  var totWhite = locacoes.filter(function(l){ return l.sala === 'white' }).reduce(function(s,l){ return s + Number(l.valor||0) }, 0)
  var totReceita = totBlack + totWhite
  var totComissao = comissoes.reduce(function(s,c){ return s + Number(c.comissao_valor||0) }, 0)
  var totContas = contas.reduce(function(s,c){ return s + Number(c.valor||0) }, 0)
  var totDespesa = totComissao + totContas
  var resultado = totReceita - totDespesa
  var margem = totReceita > 0 ? (resultado/totReceita)*100 : 0

  // Despesas por categoria
  var porCat = {}
  contas.forEach(function(c){ var cat = c.categoria || 'Outras'; porCat[cat] = (porCat[cat]||0) + Number(c.valor||0) })
  if (totComissao > 0) porCat['Comissões responsáveis'] = (porCat['Comissões responsáveis']||0) + totComissao
  var catList = Object.keys(porCat).map(function(k){ return { categoria: k, valor: porCat[k] } }).sort(function(a,b){ return b.valor - a.valor })

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>📊 DRE — Storydoing</div>
        <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Demonstrativo de resultado das salas Black e White (regime de caixa).</div>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <select style={{ ...inputStyle, width:180 }} value={periodo} onChange={function(e){ setPeriodo(e.target.value) }}>
          <option value="mes_atual">Mês atual</option>
          <option value="mes_anterior">Mês anterior</option>
          <option value="trimestre">Últimos 3 meses</option>
          <option value="ano">Ano atual</option>
          <option value="custom">Personalizado</option>
        </select>
        <input type="date" style={{ ...inputStyle, width:160 }} value={dtIni} onChange={function(e){ setPeriodo('custom'); setDtIni(e.target.value) }} />
        <span style={{ color:C.text3, alignSelf:'center', fontSize:12 }}>até</span>
        <input type="date" style={{ ...inputStyle, width:160 }} value={dtFim} onChange={function(e){ setPeriodo('custom'); setDtFim(e.target.value) }} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
        <Card label="Receita" value={fmt(totReceita)} sub={locacoes.length + ' locação(ões) paga(s)'} icon="📈" color="#4ade80" />
        <Card label="Despesas" value={fmt(totDespesa)} sub={contas.length + ' conta(s) + ' + comissoes.length + ' comissão(ões)'} icon="📉" color="#fca5a5" />
        <Card label="Resultado" value={fmt(resultado)} sub={resultado >= 0 ? 'lucro do período' : 'prejuízo'} icon={resultado >= 0 ? '💰' : '⚠️'} color={resultado >= 0 ? C.gold : '#f87171'} />
        <Card label="Margem" value={margem.toFixed(1)+'%'} sub="resultado/receita" icon="🎯" color={margem >= 20 ? '#4ade80' : margem >= 0 ? C.gold : '#f87171'} />
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, padding:'20px 24px' }}>
        <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Demonstrativo</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <tbody>
            <tr style={{ borderBottom:'1px solid #1c1810' }}>
              <td style={{ padding:'10px 0', color:'#4ade80', fontWeight:600 }}>(+) RECEITA OPERACIONAL</td>
              <td style={{ padding:'10px 0', textAlign:'right', color:'#4ade80', fontWeight:700 }}>{fmt(totReceita)}</td>
            </tr>
            <tr style={{ borderBottom:'1px dashed #1c1810' }}>
              <td style={{ padding:'6px 0 6px 24px', color:C.text2, fontSize:12 }}>⚫ Sala Black</td>
              <td style={{ padding:'6px 0', textAlign:'right', color:C.text2, fontSize:12 }}>{fmt(totBlack)}</td>
            </tr>
            <tr style={{ borderBottom:'1px dashed #1c1810' }}>
              <td style={{ padding:'6px 0 6px 24px', color:C.text2, fontSize:12 }}>⚪ Sala White</td>
              <td style={{ padding:'6px 0', textAlign:'right', color:C.text2, fontSize:12 }}>{fmt(totWhite)}</td>
            </tr>
            <tr style={{ borderBottom:'1px solid #1c1810' }}>
              <td style={{ padding:'10px 0', color:'#fca5a5', fontWeight:600 }}>(−) DESPESAS</td>
              <td style={{ padding:'10px 0', textAlign:'right', color:'#fca5a5', fontWeight:700 }}>{fmt(totDespesa)}</td>
            </tr>
            {catList.map(function(c) {
              return (
                <tr key={c.categoria} style={{ borderBottom:'1px dashed #1c1810' }}>
                  <td style={{ padding:'6px 0 6px 24px', color:C.text2, fontSize:12 }}>{c.categoria}</td>
                  <td style={{ padding:'6px 0', textAlign:'right', color:C.text2, fontSize:12 }}>{fmt(c.valor)}</td>
                </tr>
              )
            })}
            <tr>
              <td style={{ padding:'14px 0 6px 0', color:resultado>=0?'#c9a96e':'#f87171', fontWeight:700, fontSize:14, borderTop:'2px solid #2a2415' }}>(=) RESULTADO LÍQUIDO</td>
              <td style={{ padding:'14px 0 6px 0', textAlign:'right', color:resultado>=0?'#c9a96e':'#f87171', fontWeight:700, fontSize:16, borderTop:'2px solid #2a2415' }}>{fmt(resultado)}</td>
            </tr>
            <tr>
              <td style={{ padding:'4px 0', color:C.text3, fontSize:11 }}>Margem líquida</td>
              <td style={{ padding:'4px 0', textAlign:'right', color:C.text3, fontSize:11 }}>{margem.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {loading && <div style={{ color:C.text3, fontStyle:'italic', marginTop:20 }}>Carregando…</div>}
    </div>
  )
}

// Aba "Comissão" — visível para qualquer um (mostra suas locações como responsável)
function MinhasComissoes() {
  var auth = useAuth()
  var [locacoes, setLocacoes] = useState([])
  var [parcelasMap, setParcelasMap] = useState({})
  var [loading, setLoading] = useState(true)

  async function carregar() {
    if (!auth.profile) return
    setLoading(true)
    var rl = await supabase.from('storydoing_locacoes').select('*').eq('responsavel_id', auth.profile.id).order('data_locacao', { ascending: false })
    var locs = rl.data || []
    var ids = locs.map(function(l){ return l.id })
    var pmap = {}
    if (ids.length) {
      var rp = await supabase.from('storydoing_parcelas').select('*').in('locacao_id', ids).order('numero')
      ;(rp.data || []).forEach(function(p) { if (!pmap[p.locacao_id]) pmap[p.locacao_id] = []; pmap[p.locacao_id].push(p) })
    }
    setParcelasMap(pmap)
    setLocacoes(locs)
    setLoading(false)
  }
  useEffect(function(){ carregar() }, [auth.profile && auth.profile.id])

  var enriquecidas = locacoes.map(function(l) {
    var parcelas = parcelasMap[l.id] || []
    var valorRecebido, qtdPagas, qtdTotal
    if (parcelas.length > 0) {
      valorRecebido = parcelas.filter(function(x){return x.status==='Pago'}).reduce(function(s,x){ return s + Number(x.valor||0) }, 0)
      qtdPagas = parcelas.filter(function(x){return x.status==='Pago'}).length
      qtdTotal = parcelas.length
    } else {
      valorRecebido = l.status_pagamento === 'Pago' ? Number(l.valor||0) : 0
      qtdPagas = l.status_pagamento === 'Pago' ? 1 : 0
      qtdTotal = 1
    }
    var comissaoTotal = Number(l.comissao_valor||0)
    var comissaoLiberada = Number(l.valor) > 0 ? Math.round((comissaoTotal * valorRecebido / Number(l.valor)) * 100) / 100 : 0
    var comissaoAReceber = l.comissao_paga ? 0 : comissaoLiberada
    return { ...l, _parcelas: parcelas, _valor_recebido: valorRecebido, _qtd_pagas: qtdPagas, _qtd_total: qtdTotal, _comissao_liberada: comissaoLiberada, _comissao_a_receber: comissaoAReceber }
  })

  var totalComissaoTotal   = enriquecidas.reduce(function(s,l){ return s + Number(l.comissao_valor||0) }, 0)
  var totalComissaoLiberada = enriquecidas.reduce(function(s,l){ return s + Number(l._comissao_liberada||0) }, 0)
  var totalComissaoAReceber = enriquecidas.reduce(function(s,l){ return s + Number(l._comissao_a_receber||0) }, 0)
  var totalComissaoPaga    = enriquecidas.filter(function(l){ return l.comissao_paga }).reduce(function(s,l){ return s + Number(l.comissao_valor||0) }, 0)

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:700, color:C.text }}>🤝 Minhas Comissões — Storydoing</div>
        <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Comissões das locações onde você é responsável. Liberadas conforme as parcelas dos clientes são pagas.</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
        <Card label="Comissão total prevista" value={fmt(totalComissaoTotal)} sub={enriquecidas.length + ' locação(ões)'} icon="📊" color={C.text} />
        <Card label="Liberada" value={fmt(totalComissaoLiberada)} sub="cliente já pagou" icon="✅" color="#4ade80" />
        <Card label="A receber" value={fmt(totalComissaoAReceber)} sub="liberada e ainda não paga" icon="🤝" color={C.gold} />
        <Card label="Já recebida" value={fmt(totalComissaoPaga)} sub="comissões já pagas" icon="📤" color="#60a5fa" />
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:24, color:C.text3, fontStyle:'italic' }}>Carregando…</div>
        ) : enriquecidas.length === 0 ? (
          <div style={{ padding:30, textAlign:'center', color:C.text3, fontStyle:'italic' }}>Nenhuma locação atribuída a você ainda.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#0d0b06' }}>
                {['Data','Sala','Locador','Valor da locação','Recebido','% Comissão','Comissão liberada','A receber','Status'].map(function(h,i){
                  return <th key={i} style={{ textAlign:'left', padding:'10px 12px', fontSize:10, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {enriquecidas.map(function(l) {
                var salaLabel = l.sala === 'black' ? '⚫ Black' : '⚪ White'
                return (
                  <tr key={l.id} style={{ borderTop:'1px solid #1c1810' }}>
                    <td style={{ padding:'10px 12px', color:C.text2, fontFamily:'monospace' }}>{fmtDate(l.data_locacao)}</td>
                    <td style={{ padding:'10px 12px', color:C.text }}>{salaLabel}</td>
                    <td style={{ padding:'10px 12px', color:C.text }}>{l.locador_nome}</td>
                    <td style={{ padding:'10px 12px', color:C.text2 }}>{fmt(l.valor)}</td>
                    <td style={{ padding:'10px 12px', color:'#4ade80' }}>
                      {fmt(l._valor_recebido)}
                      {l._qtd_total > 1 && <div style={{ fontSize:10, color:C.text3 }}>{l._qtd_pagas}/{l._qtd_total} parcelas</div>}
                    </td>
                    <td style={{ padding:'10px 12px', color:C.text3 }}>{Number(l.comissao_percentual||0).toFixed(2)}%</td>
                    <td style={{ padding:'10px 12px', color:C.gold, fontWeight:600 }}>{fmt(l._comissao_liberada)}</td>
                    <td style={{ padding:'10px 12px', fontWeight:600, color: l.comissao_paga ? '#4ade80' : C.gold }}>
                      {l.comissao_paga ? '✓ ' + fmt(l.comissao_valor) : fmt(l._comissao_a_receber)}
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      {l.comissao_paga
                        ? <span style={{ background:'#14532d22', border:'1px solid #14532d', color:'#4ade80', padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>Recebida em {fmtDate(l.comissao_paga_em)}</span>
                        : l._comissao_a_receber > 0
                          ? <span style={{ background:'#78350f22', border:'1px solid #78350f', color:'#fbbf24', padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>A receber</span>
                          : <span style={{ background:'#1c1810', border:'1px solid #2a2415', color:'#7a6a4a', padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>Aguardando cliente</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function StorydoingHub() {
  var auth = useAuth()
  var soComissao = auth.isStorydoing  // role restrito vê só a aba "Minhas Comissões"
  var [aba, setAba] = useState(soComissao ? 'comissao' : 'locacoes')
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#0a0900', overflow:'hidden' }}>
      <div style={{ display:'flex', borderBottom:'1px solid #2a2415', background:'#0d0b06', padding:'0 16px', flexShrink:0 }}>
        {!soComissao && <Tab active={aba==='locacoes'}  onClick={function(){ setAba('locacoes') }}  icon="🏢">Locações</Tab>}
        {!soComissao && <Tab active={aba==='contas'}    onClick={function(){ setAba('contas') }}    icon="📄">Contas a Pagar</Tab>}
        {!soComissao && <Tab active={aba==='dre'}       onClick={function(){ setAba('dre') }}       icon="📊">DRE</Tab>}
        <Tab active={aba==='comissao'} onClick={function(){ setAba('comissao') }} icon="🤝">{soComissao ? 'Minhas comissões' : 'Comissões'}</Tab>
      </div>
      <div style={{ flex:1, overflow:'hidden' }}>
        {!soComissao && aba === 'locacoes' && <StorydoingPage />}
        {!soComissao && aba === 'contas'   && <ContasPagarPage origem="Storydoing" />}
        {!soComissao && aba === 'dre'      && <StorydoingDRE />}
        {aba === 'comissao' && <MinhasComissoes />}
      </div>
    </div>
  )
}
