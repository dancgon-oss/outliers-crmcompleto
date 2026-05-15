import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, C } from '../lib/ui'

var inputStyle = {
  background:'#0a0900', border:'1px solid #2a2415', borderRadius:6,
  padding:'8px 12px', color:'#f0ead8', fontSize:13, fontFamily:'Inter,sans-serif', outline:'none',
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

function ymd(d){ return d.toISOString().slice(0,10) }
function inicioMes(d){ return ymd(new Date(d.getFullYear(), d.getMonth(), 1)) }
function fimMes(d){ return ymd(new Date(d.getFullYear(), d.getMonth()+1, 0)) }
function mesLabel(iso) {
  if (!iso) return ''
  var p = iso.split('-')
  var meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return meses[Number(p[1])-1] + '/' + p[0].slice(2)
}

export default function MniDREPage() {
  var hoje = new Date()
  var [periodo, setPeriodo] = useState('mes_atual')
  var [dtIni, setDtIni] = useState(inicioMes(hoje))
  var [dtFim, setDtFim] = useState(fimMes(hoje))
  var [receitas, setReceitas] = useState([])
  var [custos, setCustos] = useState([])
  var [socios, setSocios] = useState([])
  var [loading, setLoading] = useState(true)
  var [editandoSocios, setEditandoSocios] = useState(false)
  var [sociosEdit, setSociosEdit] = useState([])

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
    var [rec, cst, soc] = await Promise.all([
      // Receita: parcelas pagas no período de clientes programa='MNI'
      supabase.from('parcelas')
        .select('id, valor, pago_em, financeiro:financeiro_id(cliente_id, clientes:cliente_id(programa))')
        .eq('status', 'Pago')
        .gte('pago_em', dtIni).lte('pago_em', dtFim + 'T23:59:59'),
      // Custos: contas_pagar origem=MNI pagas no período
      supabase.from('contas_pagar').select('id, descricao, categoria, valor, pago_em')
        .eq('status', 'Pago').eq('origem', 'MNI')
        .gte('pago_em', dtIni).lte('pago_em', dtFim + 'T23:59:59'),
      // Sócios
      supabase.from('mni_socios').select('*').eq('ativo', true).order('ordem'),
    ])
    // Filtra só parcelas de MNI (vai precisar checar pelo nested join)
    var parcs = (rec.data || []).filter(function(p) {
      return p.financeiro && p.financeiro.clientes && p.financeiro.clientes.programa === 'MNI'
    })
    setReceitas(parcs)
    setCustos(cst.data || [])
    setSocios(soc.data || [])
    setLoading(false)
  }

  // ─── Totais ─────────────────────────────────────────────
  var totReceita = receitas.reduce(function(s,r){ return s + Number(r.valor||0) }, 0)
  var totCustos = custos.reduce(function(s,c){ return s + Number(c.valor||0) }, 0)
  var lucro = totReceita - totCustos
  var margem = totReceita > 0 ? (lucro/totReceita)*100 : 0

  // Custos por categoria
  var porCat = {}
  custos.forEach(function(c){
    var k = c.categoria || 'Outros'
    porCat[k] = (porCat[k]||0) + Number(c.valor||0)
  })
  var catList = Object.keys(porCat).map(function(k){ return { categoria: k, valor: porCat[k] } }).sort(function(a,b){ return b.valor - a.valor })

  // Split entre sócios
  var splits = socios.map(function(s) {
    return { ...s, valor: lucro > 0 ? (lucro * Number(s.percentual)/100) : 0 }
  })

  // Receita por mês (pra gráfico simples)
  var porMes = {}
  receitas.forEach(function(r) {
    if (!r.pago_em) return
    var iso = r.pago_em.slice(0,7) + '-01'
    porMes[iso] = (porMes[iso]||0) + Number(r.valor||0)
  })
  var mesList = Object.keys(porMes).sort()

  // ─── Edição de sócios ──────────────────────────────────
  function abrirEdicao() {
    setSociosEdit(socios.map(function(s){ return { ...s } }))
    setEditandoSocios(true)
  }
  async function salvarSocios() {
    for (var i = 0; i < sociosEdit.length; i++) {
      var s = sociosEdit[i]
      await supabase.from('mni_socios').update({
        nome: s.nome,
        percentual: Number(s.percentual),
        ativo: !!s.ativo,
        ordem: i,
      }).eq('id', s.id)
    }
    setEditandoSocios(false)
    await carregar()
  }

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>📊 DRE — MNI</div>
        <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Demonstrativo do Método Neuro Impacto (regime de caixa). Receita = parcelas pagas; Custos = contas a pagar com origem MNI.</div>
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
        <Card label="Receita" value={fmt(totReceita)} sub={receitas.length + ' parcela(s) recebida(s)'} icon="📈" color={C.green} />
        <Card label="Custos" value={fmt(totCustos)} sub={custos.length + ' despesa(s)'} icon="📉" color="#fca5a5" />
        <Card label="Lucro" value={fmt(lucro)} sub={lucro >= 0 ? 'lucro do período' : 'prejuízo'} icon={lucro >= 0 ? '💰' : '⚠️'} color={lucro >= 0 ? C.gold : C.red} />
        <Card label="Margem" value={margem.toFixed(1)+'%'} sub="lucro/receita" icon="🎯" color={margem >= 20 ? C.green : margem >= 0 ? C.gold : C.red} />
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, padding:'20px 24px', marginBottom:18 }}>
        <div style={{ fontSize:14, fontWeight:600, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Demonstrativo</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <tbody>
            <tr style={{ borderBottom:'1px solid #1c1810' }}>
              <td style={{ padding:'10px 0', color:C.green, fontWeight:600 }}>(+) RECEITA</td>
              <td style={{ padding:'10px 0', textAlign:'right', color:C.green, fontWeight:700 }}>{fmt(totReceita)}</td>
            </tr>
            {mesList.map(function(m) {
              return (
                <tr key={m} style={{ borderBottom:'1px dashed #1c1810' }}>
                  <td style={{ padding:'6px 0 6px 24px', color:C.text2, fontSize:12 }}>{mesLabel(m)}</td>
                  <td style={{ padding:'6px 0', textAlign:'right', color:C.text2, fontSize:12 }}>{fmt(porMes[m])}</td>
                </tr>
              )
            })}
            <tr style={{ borderBottom:'1px solid #1c1810' }}>
              <td style={{ padding:'10px 0', color:'#fca5a5', fontWeight:600 }}>(−) CUSTOS</td>
              <td style={{ padding:'10px 0', textAlign:'right', color:'#fca5a5', fontWeight:700 }}>{fmt(totCustos)}</td>
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
              <td style={{ padding:'14px 0 6px 0', color:lucro>=0?C.gold:C.red, fontWeight:700, fontSize:14, borderTop:'2px solid #2a2415' }}>(=) LUCRO LÍQUIDO</td>
              <td style={{ padding:'14px 0 6px 0', textAlign:'right', color:lucro>=0?C.gold:C.red, fontWeight:700, fontSize:16, borderTop:'2px solid #2a2415' }}>{fmt(lucro)}</td>
            </tr>
            <tr>
              <td style={{ padding:'4px 0', color:C.text3, fontSize:11 }}>Margem líquida</td>
              <td style={{ padding:'4px 0', textAlign:'right', color:C.text3, fontSize:11 }}>{margem.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, padding:'20px 24px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.gold, textTransform:'uppercase', letterSpacing:'.08em' }}>Distribuição entre sócios</div>
          {!editandoSocios && <button onClick={abrirEdicao} style={{ background:'#1c1810', border:'1px solid #2a2415', color:C.gold, padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>Editar sócios</button>}
        </div>
        {!editandoSocios ? (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <tbody>
              {splits.map(function(s) {
                return (
                  <tr key={s.id} style={{ borderBottom:'1px dashed #1c1810' }}>
                    <td style={{ padding:'10px 0', color:C.text }}>{s.nome}</td>
                    <td style={{ padding:'10px 0', color:C.text3 }}>{Number(s.percentual).toFixed(2)}%</td>
                    <td style={{ padding:'10px 0', textAlign:'right', color:C.gold, fontWeight:600 }}>{fmt(s.valor)}</td>
                  </tr>
                )
              })}
              {splits.length === 0 && <tr><td style={{ padding:14, color:C.text3, fontStyle:'italic' }}>Nenhum sócio cadastrado.</td></tr>}
            </tbody>
          </table>
        ) : (
          <div>
            {sociosEdit.map(function(s, idx) {
              return (
                <div key={s.id || idx} style={{ display:'grid', gridTemplateColumns:'2fr 1fr auto', gap:10, marginBottom:10 }}>
                  <input value={s.nome} onChange={function(e){
                    var arr = sociosEdit.slice(); arr[idx] = { ...arr[idx], nome: e.target.value }; setSociosEdit(arr)
                  }} style={inputStyle} placeholder="Nome do sócio" />
                  <input type="number" step="0.01" value={s.percentual} onChange={function(e){
                    var arr = sociosEdit.slice(); arr[idx] = { ...arr[idx], percentual: e.target.value }; setSociosEdit(arr)
                  }} style={inputStyle} placeholder="%" />
                  <label style={{ display:'flex', alignItems:'center', gap:6, color:C.text3, fontSize:12 }}>
                    <input type="checkbox" checked={!!s.ativo} onChange={function(e){
                      var arr = sociosEdit.slice(); arr[idx] = { ...arr[idx], ativo: e.target.checked }; setSociosEdit(arr)
                    }} /> Ativo
                  </label>
                </div>
              )
            })}
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
              <button onClick={function(){ setEditandoSocios(false) }} style={{ background:'transparent', border:'1px solid #2a2415', color:C.text3, padding:'8px 14px', borderRadius:6, fontSize:12, cursor:'pointer' }}>Cancelar</button>
              <button onClick={salvarSocios} style={{ background:C.gold, color:C.bg, border:'none', padding:'8px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>Salvar</button>
            </div>
            <div style={{ marginTop:10, color:C.text3, fontSize:11 }}>Soma atual: {sociosEdit.reduce(function(s,x){ return s + Number(x.percentual||0) }, 0).toFixed(2)}%</div>
          </div>
        )}
      </div>

      {loading && <div style={{ color:C.text3, fontStyle:'italic', marginTop:20 }}>Carregando…</div>}
    </div>
  )
}
