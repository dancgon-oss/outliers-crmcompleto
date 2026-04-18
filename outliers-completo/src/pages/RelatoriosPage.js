import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, C } from '../lib/ui'

export default function RelatoriosPage() {
  var [eventos, setEventos] = useState([])
  var [selectedEvento, setSelectedEvento] = useState('todos')
  var [periodo, setPeriodo] = useState({ de: '', ate: '' })
  var [dados, setDados] = useState(null)
  var [loading, setLoading] = useState(false)

  useEffect(function() {
    supabase.from('eventos').select('*').order('data_inicio', { ascending: false }).then(function(r){ setEventos(r.data || []) })
  }, [])

  async function gerarRelatorio() {
    setLoading(true)
    try {
      var qPart = supabase.from('participantes').select('*, eventos(nome,data_inicio)')
      var qCli  = supabase.from('clientes').select('id,nome,status,origem')
      var qFin  = supabase.from('financeiro').select('*, parcelas(*)')

      if (selectedEvento !== 'todos') qPart = qPart.eq('evento_id', selectedEvento)
      if (periodo.de)  qPart = qPart.gte('created_at', periodo.de)
      if (periodo.ate) qPart = qPart.lte('created_at', periodo.ate + 'T23:59:59')

      var [rPart, rCli, rFin] = await Promise.all([qPart, qCli, qFin])
      var partes  = rPart.data || []
      var clientes = rCli.data || []
      var fins    = rFin.data || []

      var inscritos = partes.length
      var presentes = partes.filter(function(p){ return p.checkin_at }).length
      var compraram = partes.filter(function(p){ return p.comprou }).length

      var totalFat = fins.reduce(function(acc,f){ return acc + (Number(f.valor_total) - Number(f.desconto)) }, 0)
      var totalRec = fins.reduce(function(acc,f){ return acc + (f.parcelas||[]).filter(function(p){ return p.status==='Pago' }).reduce(function(s,p){ return s+Number(p.valor) }, 0) }, 0)
      var totalPend = fins.reduce(function(acc,f){ return acc + (f.parcelas||[]).filter(function(p){ return p.status!=='Pago' }).reduce(function(s,p){ return s+Number(p.valor) }, 0) }, 0)

      var origemCount = {}
      clientes.forEach(function(c){ origemCount[c.origem] = (origemCount[c.origem]||0)+1 })

      setDados({ inscritos,presentes,compraram,totalFat,totalRec,totalPend,origemCount,partes,clientes,fins })
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  function exportarCSV() {
    if (!dados) return
    var rows = [['Nome','Telefone','Evento','Check-in','Comprou']]
    dados.partes.forEach(function(p) {
      rows.push([p.nome,p.telefone||'',p.eventos?p.eventos.nome:'',p.checkin_at?'Sim':'Nao',p.comprou?'Sim':'Nao'])
    })
    var csv = rows.map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"' }).join(',') }).join('\n')
    var blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a'); a.href=url; a.download='relatorio.csv'; a.click()
  }

  var S = {
    card: { background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10 },
    inp: { background: C.bgHover, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', fontSize: 13, borderRadius: 8, outline: 'none', fontFamily: 'Inter,sans-serif', width: '100%' },
    btnG: { background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '9px 18px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '8px 14px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 12, cursor: 'pointer' },
    lbl: { display: 'block', fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 },
  }

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: C.bg, fontFamily: 'Inter,sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>Relatorios</div>
          <div style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>Analise de eventos e financeiro</div>
        </div>
        {dados && <button style={S.btnGhost} onClick={exportarCSV}>⬇ Exportar CSV</button>}
      </div>

      {/* Filtros */}
      <div style={{ ...S.card, padding: '18px 22px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={S.lbl}>Evento</label>
            <select style={S.inp} value={selectedEvento} onChange={function(e){setSelectedEvento(e.target.value)}}>
              <option value="todos">Todos os eventos</option>
              {eventos.map(function(ev){ return <option key={ev.id} value={ev.id}>{ev.nome} — {fmtDate(ev.data_inicio)}</option> })}
            </select>
          </div>
          <div style={{ width: 150 }}>
            <label style={S.lbl}>Data inicial</label>
            <input style={S.inp} type="date" value={periodo.de} onChange={function(e){setPeriodo(function(p){return {...p,de:e.target.value}})}} />
          </div>
          <div style={{ width: 150 }}>
            <label style={S.lbl}>Data final</label>
            <input style={S.inp} type="date" value={periodo.ate} onChange={function(e){setPeriodo(function(p){return {...p,ate:e.target.value}})}} />
          </div>
          <button style={S.btnG} onClick={gerarRelatorio} disabled={loading}>{loading?'Gerando...':'Gerar Relatorio'}</button>
        </div>
      </div>

      {!dados && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: C.text3, fontSize: 14, fontStyle: 'italic' }}>
          Selecione os filtros e clique em Gerar Relatorio.
        </div>
      )}

      {dados && (<>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { l:'Inscritos',   v: dados.inscritos,                                        icon:'👥' },
            { l:'Presentes',   v: dados.presentes + ' (' + (dados.inscritos?Math.round(dados.presentes/dados.inscritos*100):0) + '%)', icon:'✅' },
            { l:'Compraram',   v: dados.compraram + ' (' + (dados.inscritos?Math.round(dados.compraram/dados.inscritos*100):0) + '%)', icon:'💰', gold:true },
            { l:'Faturamento', v: fmt(dados.totalFat),                                    icon:'📈', gold:true },
            { l:'Recebido',    v: fmt(dados.totalRec),                                    icon:'✓',  green:true },
            { l:'A Receber',   v: fmt(dados.totalPend),                                   icon:'⏳' },
            { l:'Total Clientes', v: dados.clientes.length,                               icon:'👤' },
            { l:'Inadimplentes',  v: dados.clientes.filter(function(c){return c.status==='Inadimplente'}).length, icon:'⚠️', red:true },
          ].map(function(k,i) {
            return (
              <div key={i} style={{ ...S.card, padding: '16px 18px' }}>
                <div style={{ fontSize: 18, marginBottom: 6 }}>{k.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: k.gold?C.gold:k.green?'#4ade80':k.red?C.red:C.text, letterSpacing:'-0.01em' }}>{k.v}</div>
                <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{k.l}</div>
              </div>
            )
          })}
        </div>

        {/* Origem */}
        <div style={{ ...S.card, padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>Origem dos Clientes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(dados.origemCount).map(function(entry) {
              var k = entry[0]; var v = entry[1]
              var total = Object.values(dados.origemCount).reduce(function(a,b){return a+b},0)
              var pct = total > 0 ? Math.round(v/total*100) : 0
              return (
                <div key={k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: C.text }}>{k}</span>
                    <span style={{ fontSize: 12, color: C.text3, fontFamily: 'monospace' }}>{v} ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, background: C.border, borderRadius: 3 }}>
                    <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg,#c9a96e,#a07840)', borderRadius: 3 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Tabela participantes */}
        <div style={S.card}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Lista de Participantes ({dados.partes.length})</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 80px 80px', padding: '10px 20px', borderBottom: '1px solid ' + C.border }}>
            {['Nome','Telefone','Evento','Check-in','Comprou'].map(function(h,i){ return <span key={i} style={{ fontSize: 10, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span> })}
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {dados.partes.map(function(p, i, arr) {
              return (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 80px 80px', padding: '11px 20px', borderBottom: i<arr.length-1 ? '1px solid ' + C.border : 'none', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{p.nome}</span>
                  <span style={{ fontSize: 12, color: C.text2, fontFamily: 'monospace' }}>{p.telefone}</span>
                  <span style={{ fontSize: 12, color: C.text3 }}>{p.eventos ? p.eventos.nome : '--'}</span>
                  <span style={{ fontSize: 12 }}>{p.checkin_at ? <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ Sim</span> : <span style={{ color: C.text3 }}>Nao</span>}</span>
                  <span style={{ fontSize: 12 }}>{p.comprou ? <span style={{ color: C.gold, fontWeight: 600 }}>Sim</span> : <span style={{ color: C.text3 }}>—</span>}</span>
                </div>
              )
            })}
          </div>
        </div>
      </>)}
    </div>
  )
}
