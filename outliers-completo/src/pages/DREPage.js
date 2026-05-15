import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, C } from '../lib/ui'

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

function ymd(d) { return d.toISOString().slice(0,10) }
function inicioMes(d) { var x = new Date(d.getFullYear(), d.getMonth(), 1); return ymd(x) }
function fimMes(d)    { var x = new Date(d.getFullYear(), d.getMonth()+1, 0); return ymd(x) }

export default function DREPage() {
  var hoje = new Date()
  var [periodo, setPeriodo] = useState('mes_atual')   // mes_atual | mes_anterior | trimestre | ano | custom
  var [dtIni, setDtIni] = useState(inicioMes(hoje))
  var [dtFim, setDtFim] = useState(fimMes(hoje))

  var [receitas, setReceitas] = useState([])      // parcelas pagas no periodo
  var [comissoesPagas, setComissoesPagas] = useState([])
  var [contasPagas, setContasPagas] = useState([])
  var [storydoingPagas, setStorydoingPagas] = useState([])
  var [storydoingComissoesPagas, setStorydoingComissoesPagas] = useState([])
  var [resumoMensal, setResumoMensal] = useState([])
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
    var [rec, com, ct, sd, sdc, mens] = await Promise.all([
      supabase.from('parcelas').select('id,valor,pago_em,financeiro:financeiro_id(cliente_id,clientes(nome),curso:curso_id(nome))')
        .eq('status', 'Pago')
        .gte('pago_em', dtIni).lte('pago_em', dtFim),
      supabase.from('comissao_movimentos').select('id,valor,created_at,comissao:comissao_id(beneficiario_id,profiles(nome))')
        .eq('tipo', 'pagamento')
        .gte('created_at', dtIni).lte('created_at', dtFim + 'T23:59:59'),
      supabase.from('contas_pagar').select('id,descricao,categoria,valor,pago_em,fornecedor')
        .eq('status', 'Pago')
        .gte('pago_em', dtIni).lte('pago_em', dtFim),
      supabase.from('storydoing_locacoes').select('id,sala,valor,data_pagamento,locador_nome,comissao_valor,comissao_paga,comissao_paga_em,responsavel_nome')
        .eq('status_pagamento', 'Pago')
        .gte('data_pagamento', dtIni).lte('data_pagamento', dtFim),
      supabase.from('storydoing_locacoes').select('id,comissao_valor,comissao_paga_em,responsavel_nome')
        .eq('comissao_paga', true)
        .gte('comissao_paga_em', dtIni).lte('comissao_paga_em', dtFim),
      supabase.from('vw_dre_resumo_mensal').select('*').limit(13),
    ])
    setReceitas(rec.data || [])
    setComissoesPagas(com.data || [])
    setContasPagas(ct.data || [])
    setStorydoingPagas(sd.data || [])
    setStorydoingComissoesPagas(sdc.data || [])
    setResumoMensal((mens.data || []).slice().reverse())
    setLoading(false)
  }

  // Totais
  var totReceitaCursos = receitas.reduce(function(s,p){ return s + Number(p.valor||0) }, 0)
  var totReceitaStorydoing = storydoingPagas.reduce(function(s,l){ return s + Number(l.valor||0) }, 0)
  var totReceita = totReceitaCursos + totReceitaStorydoing
  var totComissao = comissoesPagas.reduce(function(s,c){ return s + Number(c.valor||0) }, 0)
  var totComissaoSD = storydoingComissoesPagas.reduce(function(s,l){ return s + Number(l.comissao_valor||0) }, 0)
  var totContas = contasPagas.reduce(function(s,c){ return s + Number(c.valor||0) }, 0)
  var totDespesa = totComissao + totComissaoSD + totContas
  var resultado = totReceita - totDespesa
  var margem = totReceita > 0 ? (resultado / totReceita) * 100 : 0

  // Despesas por categoria
  var porCat = {}
  contasPagas.forEach(function(c) {
    var cat = c.categoria || 'Outras'
    porCat[cat] = (porCat[cat] || 0) + Number(c.valor||0)
  })
  if (totComissao > 0) porCat['Comissões (cursos)'] = (porCat['Comissões (cursos)'] || 0) + totComissao
  if (totComissaoSD > 0) porCat['Comissões (Storydoing)'] = (porCat['Comissões (Storydoing)'] || 0) + totComissaoSD
  var catList = Object.keys(porCat).map(function(k){ return { categoria: k, valor: porCat[k] } }).sort(function(a,b){ return b.valor - a.valor })

  // Receita por origem
  var porCurso = {}
  receitas.forEach(function(p) {
    var nm = (p.financeiro && p.financeiro.curso && p.financeiro.curso.nome) || '(sem curso)'
    porCurso[nm] = (porCurso[nm] || 0) + Number(p.valor||0)
  })
  // Storydoing entra como linhas separadas (Black/White)
  storydoingPagas.forEach(function(l) {
    var nm = 'Storydoing — Sala ' + (l.sala === 'black' ? 'Black' : 'White')
    porCurso[nm] = (porCurso[nm] || 0) + Number(l.valor||0)
  })
  var cursoList = Object.keys(porCurso).map(function(k){ return { nome: k, valor: porCurso[k] } }).sort(function(a,b){ return b.valor - a.valor })

  function maxResumo() {
    return resumoMensal.reduce(function(m,r){ return Math.max(m, Number(r.receita||0), Number(r.despesas||0)) }, 1)
  }

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>DRE</div>
        <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Demonstração do Resultado · regime de caixa (apenas o que efetivamente entrou e saiu).</div>
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
        <Card label="Receita realizada" value={fmt(totReceita)} sub={receitas.length + ' parcela(s) recebida(s)'} icon="📈" color="#4ade80" />
        <Card label="Despesas" value={fmt(totDespesa)} sub={contasPagas.length + ' conta(s) + ' + comissoesPagas.length + ' comissão(ões)'} icon="📉" color="#fca5a5" />
        <Card label="Resultado" value={fmt(resultado)} sub={resultado >= 0 ? 'lucro do período' : 'prejuízo do período'} icon={resultado >= 0 ? '💰' : '⚠️'} color={resultado >= 0 ? '#c9a96e' : '#f87171'} />
        <Card label="Margem" value={margem.toFixed(1) + '%'} sub="resultado/receita" icon="🎯" color={margem >= 20 ? '#4ade80' : margem >= 0 ? C.gold : '#f87171'} />
      </div>

      {/* DRE estilo "demonstrativo" */}
      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, padding:'20px 24px', marginBottom:24 }}>
        <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Demonstrativo</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <tbody>
            <tr style={{ borderBottom:'1px solid #1c1810' }}>
              <td style={{ padding:'10px 0', color:'#4ade80', fontWeight:600 }}>(+) RECEITA OPERACIONAL</td>
              <td style={{ padding:'10px 0', textAlign:'right', color:'#4ade80', fontWeight:700 }}>{fmt(totReceita)}</td>
            </tr>
            {cursoList.map(function(c) {
              return (
                <tr key={c.nome} style={{ borderBottom:'1px dashed #1c1810' }}>
                  <td style={{ padding:'6px 0 6px 24px', color:C.text2, fontSize:12 }}>{c.nome}</td>
                  <td style={{ padding:'6px 0', textAlign:'right', color:C.text2, fontSize:12 }}>{fmt(c.valor)}</td>
                </tr>
              )
            })}
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

      {/* Comparativo mensal (gráfico de barras texto) */}
      {resumoMensal.length > 0 && (
        <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, padding:'20px 24px', marginBottom:24 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Histórico mensal (últimos meses)</div>
          {(function(){ var max = maxResumo(); return resumoMensal.map(function(m) {
            var pctRec = max > 0 ? (Number(m.receita||0)/max*100) : 0
            var pctDes = max > 0 ? (Number(m.despesas||0)/max*100) : 0
            return (
              <div key={m.mes} style={{ marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:C.text3, marginBottom:4 }}>
                  <span>{m.mes}</span>
                  <span style={{ color: Number(m.resultado||0) >= 0 ? '#4ade80' : '#fca5a5', fontWeight:600 }}>
                    Resultado: {fmt(m.resultado)}
                  </span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ fontSize:10, color:'#7a6a4a', width:60 }}>Receita</span>
                  <div style={{ flex:1, height:14, background:'#0a0900', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:pctRec+'%', background:'linear-gradient(90deg,#14532d,#4ade80)', transition:'width .3s' }} />
                  </div>
                  <span style={{ fontSize:11, color:'#4ade80', width:90, textAlign:'right' }}>{fmt(m.receita)}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:10, color:'#7a6a4a', width:60 }}>Despesa</span>
                  <div style={{ flex:1, height:14, background:'#0a0900', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:pctDes+'%', background:'linear-gradient(90deg,#7f1d1d,#fca5a5)', transition:'width .3s' }} />
                  </div>
                  <span style={{ fontSize:11, color:'#fca5a5', width:90, textAlign:'right' }}>{fmt(m.despesas)}</span>
                </div>
              </div>
            )
          }) })()}
        </div>
      )}

      {loading && <div style={{ color:C.text3, fontStyle:'italic' }}>Carregando…</div>}
    </div>
  )
}
