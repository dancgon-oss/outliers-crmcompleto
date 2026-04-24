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
      var qCli  = supabase.from('clientes').select('id,nome,status,origem,programa,stage,responsavel_id')
      var qFin  = supabase.from('financeiro').select('*, parcelas(*), clientes:cliente_id(programa,origem,responsavel_id)')
      var qProf = supabase.from('profiles').select('id,nome,role').in('role', ['admin','comercial'])

      if (selectedEvento !== 'todos') qPart = qPart.eq('evento_id', selectedEvento)
      if (periodo.de)  qPart = qPart.gte('created_at', periodo.de)
      if (periodo.ate) qPart = qPart.lte('created_at', periodo.ate + 'T23:59:59')

      var [rPart, rCli, rFin, rProf] = await Promise.all([qPart, qCli, qFin, qProf])
      var partes  = rPart.data || []
      var clientes = rCli.data || []
      var fins    = rFin.data || []
      var profiles = rProf.data || []

      var inscritos = partes.length
      var presentes = partes.filter(function(p){ return p.checkin_at }).length
      var compraram = partes.filter(function(p){ return p.comprou }).length

      var totalFat = fins.reduce(function(acc,f){ return acc + (Number(f.valor_total) - Number(f.desconto)) }, 0)
      var totalRec = fins.reduce(function(acc,f){ return acc + (f.parcelas||[]).filter(function(p){ return p.status==='Pago' }).reduce(function(s,p){ return s+Number(p.valor) }, 0) }, 0)
      var totalPend = fins.reduce(function(acc,f){ return acc + (f.parcelas||[]).filter(function(p){ return p.status!=='Pago' }).reduce(function(s,p){ return s+Number(p.valor) }, 0) }, 0)

      var origemCount = {}
      clientes.forEach(function(c){ origemCount[c.origem] = (origemCount[c.origem]||0)+1 })

      // ── Pipeline: funil de leads por stage ──
      var STAGE_ORDER = ['Novo','Em contato','Proposta','Ganho','Perdido']
      var funil = {}
      STAGE_ORDER.forEach(function(s){ funil[s] = 0 })
      clientes.forEach(function(c){ if (c.stage && funil[c.stage] !== undefined) funil[c.stage]++ })

      // ── Receita por programa ──
      var receitaPrograma = {}
      fins.forEach(function(f) {
        var prog = (f.clientes && f.clientes.programa) || 'Sem programa'
        var liq = Number(f.valor_total) - Number(f.desconto)
        var rec = (f.parcelas || []).filter(function(p){ return p.status === 'Pago' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)
        if (!receitaPrograma[prog]) receitaPrograma[prog] = { vendas: 0, faturamento: 0, recebido: 0 }
        receitaPrograma[prog].vendas++
        receitaPrograma[prog].faturamento += liq
        receitaPrograma[prog].recebido += rec
      })

      // ── Fluxo de caixa previsto: parcelas não pagas agrupadas por mês ──
      var fluxoCaixa = {}
      fins.forEach(function(f) {
        (f.parcelas || []).forEach(function(p) {
          if (p.status === 'Pago' || !p.vencimento) return
          var mes = String(p.vencimento).slice(0, 7)   // YYYY-MM
          if (!fluxoCaixa[mes]) fluxoCaixa[mes] = { pendente: 0, atrasado: 0, count: 0 }
          fluxoCaixa[mes].count++
          if (p.status === 'Atrasado') fluxoCaixa[mes].atrasado += Number(p.valor)
          else fluxoCaixa[mes].pendente += Number(p.valor)
        })
      })

      // ── Performance por comercial ──
      var perfComercial = {}
      profiles.forEach(function(p){
        perfComercial[p.id] = { nome: p.nome, leads: 0, ganhos: 0, perdidos: 0, clientesAtivos: 0, receita: 0 }
      })
      clientes.forEach(function(c){
        if (!c.responsavel_id || !perfComercial[c.responsavel_id]) return
        perfComercial[c.responsavel_id].leads++
        if (c.stage === 'Ganho') perfComercial[c.responsavel_id].ganhos++
        if (c.stage === 'Perdido') perfComercial[c.responsavel_id].perdidos++
        if (c.status === 'Ativo' && !c.stage) perfComercial[c.responsavel_id].clientesAtivos++
      })
      fins.forEach(function(f){
        var resp = f.clientes && f.clientes.responsavel_id
        if (resp && perfComercial[resp]) {
          perfComercial[resp].receita += (Number(f.valor_total) - Number(f.desconto))
        }
      })

      setDados({ inscritos,presentes,compraram,totalFat,totalRec,totalPend,origemCount,partes,clientes,fins,
        funil: funil, funilOrdem: STAGE_ORDER,
        receitaPrograma: receitaPrograma,
        fluxoCaixa: fluxoCaixa,
        perfComercial: perfComercial,
      })
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

        {/* Funil do Pipeline */}
        {dados.funil && Object.values(dados.funil).some(function(v){ return v > 0 }) && (
          <div style={{ ...S.card, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>Funil do Pipeline</div>
            <div style={{ fontSize: 11, color: C.text3, marginBottom: 16 }}>Leads comerciais agrupados por estágio. Conversão = Ganho / (Ganho + Perdido).</div>
            {(function() {
              var total = Object.values(dados.funil).reduce(function(a,b){return a+b},0)
              var maxV = Math.max.apply(null, Object.values(dados.funil).concat([1]))
              var ganho = dados.funil['Ganho'] || 0
              var perdido = dados.funil['Perdido'] || 0
              var taxaConv = (ganho + perdido) > 0 ? Math.round(ganho / (ganho + perdido) * 100) : 0
              var CORES = { 'Novo':'#60a5fa','Em contato':'#c9a96e','Proposta':'#a78bfa','Ganho':'#4ade80','Perdido':'#f87171' }
              return (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {dados.funilOrdem.map(function(st){
                      var v = dados.funil[st] || 0
                      var pct = maxV > 0 ? Math.round(v/maxV*100) : 0
                      var cor = CORES[st] || C.gold
                      return (
                        <div key={st}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 9999, background: cor }} />
                              {st}
                            </span>
                            <span style={{ fontSize: 12, color: C.text3, fontFamily: 'monospace' }}>{v} leads</span>
                          </div>
                          <div style={{ height: 8, background: C.border, borderRadius: 4 }}>
                            <div style={{ width: pct + '%', height: '100%', background: cor, borderRadius: 4 }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginTop: 18, paddingTop: 16, borderTop: '1px solid ' + C.border, fontSize: 12 }}>
                    <div><span style={{ color: C.text3 }}>Total no funil: </span><b style={{ color: C.text }}>{total}</b></div>
                    <div><span style={{ color: C.text3 }}>Taxa de conversão: </span><b style={{ color: '#4ade80' }}>{taxaConv}%</b></div>
                    <div><span style={{ color: C.text3 }}>Ativos: </span><b style={{ color: C.gold }}>{total - (dados.funil['Ganho']||0) - (dados.funil['Perdido']||0)}</b></div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Receita por Programa */}
        {dados.receitaPrograma && Object.keys(dados.receitaPrograma).length > 0 && (
          <div style={{ ...S.card, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>Receita por Programa</div>
            {(function() {
              var entries = Object.entries(dados.receitaPrograma).sort(function(a,b){ return b[1].faturamento - a[1].faturamento })
              var totalFat = entries.reduce(function(s,e){ return s + e[1].faturamento }, 0)
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {entries.map(function(entry){
                    var nome = entry[0]; var d = entry[1]
                    var pct = totalFat > 0 ? Math.round(d.faturamento/totalFat*100) : 0
                    var recPct = d.faturamento > 0 ? Math.round(d.recebido/d.faturamento*100) : 0
                    return (
                      <div key={nome}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'baseline', gap: 10 }}>
                          <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{nome}</span>
                          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>
                            <span>{d.vendas} venda{d.vendas !== 1 ? 's' : ''}</span>
                            <span style={{ color: C.gold, fontWeight: 600 }}>{fmt(d.faturamento)}</span>
                            <span style={{ color: '#4ade80' }}>{recPct}% recebido</span>
                          </div>
                        </div>
                        <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg,#c9a96e,#a07840)' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* Fluxo de Caixa Previsto */}
        {dados.fluxoCaixa && Object.keys(dados.fluxoCaixa).length > 0 && (
          <div style={{ ...S.card, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>Fluxo de Caixa Previsto</div>
            <div style={{ fontSize: 11, color: C.text3, marginBottom: 16 }}>Parcelas não pagas agrupadas por mês de vencimento.</div>
            {(function() {
              var meses = Object.keys(dados.fluxoCaixa).sort()
              var maxTotal = Math.max.apply(null, meses.map(function(m){
                var d = dados.fluxoCaixa[m]; return d.pendente + d.atrasado
              }).concat([1]))
              var nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {meses.map(function(m){
                    var d = dados.fluxoCaixa[m]
                    var total = d.pendente + d.atrasado
                    var pctP = maxTotal > 0 ? d.pendente/maxTotal*100 : 0
                    var pctA = maxTotal > 0 ? d.atrasado/maxTotal*100 : 0
                    var parts = m.split('-')
                    var label = nomes[Number(parts[1]) - 1] + '/' + parts[0].slice(2)
                    return (
                      <div key={m}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                          <span style={{ color: C.text, fontWeight: 500 }}>{label}</span>
                          <div style={{ display: 'flex', gap: 10, fontFamily: 'monospace', color: C.text3 }}>
                            {d.atrasado > 0 && <span style={{ color: '#f87171' }}>Atrasado: {fmt(d.atrasado)}</span>}
                            <span style={{ color: C.gold, fontWeight: 600 }}>{fmt(total)}</span>
                            <span>({d.count} parc)</span>
                          </div>
                        </div>
                        <div style={{ height: 10, background: C.border, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                          <div style={{ width: pctA + '%', height: '100%', background: '#f87171' }} />
                          <div style={{ width: pctP + '%', height: '100%', background: 'linear-gradient(90deg,#c9a96e,#a07840)' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* Performance por Comercial */}
        {dados.perfComercial && Object.values(dados.perfComercial).some(function(p){ return p.leads > 0 || p.receita > 0 }) && (
          <div style={{ ...S.card, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>Performance por Comercial</div>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 90px 140px', padding: '8px 0', borderBottom: '1px solid ' + C.border }}>
                {['Comercial','Leads','Ganho','Perdido','Conv.','Receita'].map(function(h, i){
                  return <span key={i} style={{ fontSize: 10, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</span>
                })}
              </div>
              {Object.values(dados.perfComercial)
                .filter(function(p){ return p.leads > 0 || p.receita > 0 })
                .sort(function(a,b){ return b.receita - a.receita })
                .map(function(p, i){
                  var conv = (p.ganhos + p.perdidos) > 0 ? Math.round(p.ganhos / (p.ganhos + p.perdidos) * 100) : 0
                  return (
                    <div key={p.nome + i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 90px 140px', padding: '10px 0', borderBottom: '1px solid ' + C.border, alignItems: 'center', fontSize: 13 }}>
                      <span style={{ color: C.text, fontWeight: 500 }}>{p.nome}</span>
                      <span style={{ color: C.text2, fontFamily: 'monospace' }}>{p.leads}</span>
                      <span style={{ color: '#4ade80', fontFamily: 'monospace', fontWeight: 600 }}>{p.ganhos}</span>
                      <span style={{ color: '#f87171', fontFamily: 'monospace' }}>{p.perdidos}</span>
                      <span style={{ color: C.gold, fontFamily: 'monospace', fontWeight: 600 }}>{conv}%</span>
                      <span style={{ color: C.text, fontWeight: 600 }}>{fmt(p.receita)}</span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

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
