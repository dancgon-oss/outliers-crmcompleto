import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, C, INPUT_S, BTN_PRIMARY, BTN_GHOST, LABEL_S, CARD_S } from '../lib/ui'

export default function RelatoriosPage() {
  var [eventos, setEventos] = useState([])
  var [selectedEvento, setSelectedEvento] = useState('todos')
  var [periodo, setPeriodo] = useState({ de: '', ate: '' })
  var [dados, setDados] = useState(null)
  var [loading, setLoading] = useState(false)

  useEffect(function() {
    supabase.from('eventos').select('*').order('data_inicio', { ascending: false }).then(function(r) { setEventos(r.data || []) })
  }, [])

  async function gerarRelatorio() {
    setLoading(true)
    try {
      var qPart = supabase.from('participantes').select('*, eventos(nome,data_inicio)')
      var qCli  = supabase.from('clientes').select('id,nome,email,telefone,status,origem,created_at')
      var qFin  = supabase.from('financeiro').select('*, parcelas(*)')
      var qVendas = supabase.from('vendas').select('*, cursos(nome,categoria), clientes(nome)')

      if (selectedEvento !== 'todos') qPart = qPart.eq('evento_id', selectedEvento)
      if (periodo.de) qPart = qPart.gte('created_at', periodo.de)
      if (periodo.ate) qPart = qPart.lte('created_at', periodo.ate + 'T23:59:59')

      var [rPart, rCli, rFin, rVendas] = await Promise.all([qPart, qCli, qFin, qVendas])
      var partes   = rPart.data || []
      var clientes = rCli.data || []
      var fins     = rFin.data || []
      var vendas   = rVendas.data || []

      var inscritos  = partes.length
      var presentes  = partes.filter(function(p) { return p.checkin_at }).length
      var ausentes   = inscritos - presentes
      var compraram  = partes.filter(function(p) { return p.comprou }).length

      var totalFat  = fins.reduce(function(acc, f) { return acc + (Number(f.valor_total) - Number(f.desconto)) }, 0)
      var totalRec  = fins.reduce(function(acc, f) { return acc + (f.parcelas || []).filter(function(p) { return p.status === 'Pago' }).reduce(function(s, p) { return s + Number(p.valor) }, 0) }, 0)
      var totalPend = fins.reduce(function(acc, f) { return acc + (f.parcelas || []).filter(function(p) { return p.status !== 'Pago' }).reduce(function(s, p) { return s + Number(p.valor) }, 0) }, 0)
      var totalAtra = fins.reduce(function(acc, f) { return acc + (f.parcelas || []).filter(function(p) { return p.status === 'Atrasado' }).reduce(function(s, p) { return s + Number(p.valor) }, 0) }, 0)

      var origemCount = {}
      clientes.forEach(function(c) { origemCount[c.origem] = (origemCount[c.origem] || 0) + 1 })

      var cursosVendidos = {}
      vendas.forEach(function(v) {
        var nome = v.cursos ? v.cursos.nome : 'Desconhecido'
        if (!cursosVendidos[nome]) cursosVendidos[nome] = { qtd: 0, total: 0, categoria: v.cursos ? v.cursos.categoria : '' }
        cursosVendidos[nome].qtd++
        cursosVendidos[nome].total += Number(v.valor)
      })

      setDados({ inscritos, presentes, ausentes, compraram, totalFat, totalRec, totalPend, totalAtra, origemCount, partes, clientes, fins, cursosVendidos })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  function exportarCSV() {
    if (!dados) return
    var rows = [['Nome','Telefone','Email','Evento','Check-in','Comprou','Status']]
    dados.partes.forEach(function(p) {
      rows.push([p.nome, p.telefone || '', p.email || '', p.eventos ? p.eventos.nome : '', p.checkin_at ? 'Sim' : 'Nao', p.comprou ? 'Sim' : 'Nao', p.checkin_at ? 'Presente' : 'Ausente'])
    })
    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"' }).join(',') }).join('\n')
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a'); a.href = url; a.download = 'relatorio.csv'; a.click()
  }

  var S = { card: CARD_S, inp: INPUT_S, btnG: BTN_PRIMARY, btnGhost: BTN_GHOST, lbl: LABEL_S }

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: C.bg, fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Relatorios</div>
          <div style={{ fontSize: 14, color: C.text3, marginTop: 5 }}>Analise completa de eventos e financeiro</div>
        </div>
        {dados && <button style={S.btnGhost} onClick={exportarCSV}>⬇ Exportar CSV</button>}
      </div>

      <div style={{ ...S.card, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={S.lbl}>Evento</label>
            <select style={S.inp} value={selectedEvento} onChange={function(e) { setSelectedEvento(e.target.value) }}>
              <option value="todos">Todos os eventos</option>
              {eventos.map(function(ev) { return <option key={ev.id} value={ev.id}>{ev.nome} — {fmtDate(ev.data_inicio)}</option> })}
            </select>
          </div>
          <div style={{ width: 160 }}>
            <label style={S.lbl}>Data inicial</label>
            <input style={S.inp} type="date" value={periodo.de} onChange={function(e) { setPeriodo(function(p) { return { ...p, de: e.target.value } }) }} />
          </div>
          <div style={{ width: 160 }}>
            <label style={S.lbl}>Data final</label>
            <input style={S.inp} type="date" value={periodo.ate} onChange={function(e) { setPeriodo(function(p) { return { ...p, ate: e.target.value } }) }} />
          </div>
          <button style={S.btnG} onClick={gerarRelatorio} disabled={loading}>{loading ? 'Gerando...' : 'Gerar Relatorio'}</button>
        </div>
      </div>

      {!dados && !loading && (
        <div style={{ textAlign: 'center', padding: 80, color: C.text3, fontSize: 15, fontStyle: 'italic' }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>📊</div>
          Selecione os filtros e clique em Gerar Relatorio.
        </div>
      )}

      {dados && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
            {[
              { l: 'Inscritos',    v: dados.inscritos,                                                              icon: '👥' },
              { l: 'Presentes',    v: dados.presentes + ' (' + (dados.inscritos ? Math.round(dados.presentes/dados.inscritos*100) : 0) + '%)', icon: '✅', green: true },
              { l: 'Ausentes',     v: dados.ausentes + ' (' + (dados.inscritos ? Math.round(dados.ausentes/dados.inscritos*100) : 0) + '%)',  icon: '❌', red: true },
              { l: 'Compraram',    v: dados.compraram + ' (' + (dados.inscritos ? Math.round(dados.compraram/dados.inscritos*100) : 0) + '%)',icon: '💰', gold: true },
              { l: 'Faturamento',  v: fmt(dados.totalFat),   icon: '📈', gold: true },
              { l: 'Recebido',     v: fmt(dados.totalRec),   icon: '✓',  green: true },
              { l: 'A Receber',    v: fmt(dados.totalPend),  icon: '⏳' },
              { l: 'Em Atraso',    v: fmt(dados.totalAtra),  icon: '🔴', red: dados.totalAtra > 0 },
            ].map(function(k, i) {
              return (
                <div key={i} style={{ ...S.card, padding: '16px 18px' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{k.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: k.gold ? C.gold : k.green ? '#4ade80' : k.red ? C.red : C.text, letterSpacing: '-0.01em' }}>{k.v}</div>
                  <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 5 }}>{k.l}</div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            <div style={{ ...S.card, padding: '20px 24px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>Origem dos Clientes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Object.entries(dados.origemCount).map(function(entry) {
                  var k = entry[0]; var v = entry[1]
                  var total = Object.values(dados.origemCount).reduce(function(a, b) { return a + b }, 0)
                  var pct = total > 0 ? Math.round(v / total * 100) : 0
                  return (
                    <div key={k}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 14, color: C.text }}>{k}</span>
                        <span style={{ fontSize: 13, color: C.text3 }}>{v} ({pct}%)</span>
                      </div>
                      <div style={{ height: 6, background: C.border, borderRadius: 3 }}>
                        <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg,#c9a96e,#a07840)', borderRadius: 3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ ...S.card, padding: '20px 24px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>Cursos Vendidos</div>
              {Object.keys(dados.cursosVendidos).length === 0 ? (
                <div style={{ color: C.text3, fontSize: 14, fontStyle: 'italic' }}>Nenhuma venda registrada.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Object.entries(dados.cursosVendidos).map(function(entry) {
                    var nome = entry[0]; var info = entry[1]
                    return (
                      <div key={nome} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: C.bgHover, borderRadius: 8, border: '1px solid ' + C.border }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{nome}</div>
                          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{info.categoria} · {info.qtd} venda{info.qtd !== 1 ? 's' : ''}</div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: C.gold }}>{fmt(info.total)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={S.card}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Participantes ({dados.partes.length})</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 80px 80px 80px', padding: '10px 20px', borderBottom: '1px solid ' + C.border }}>
              {['Nome','Telefone','Evento','Dia 1','Dia 2','Dia 3'].map(function(h, i) { return <span key={i} style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span> })}
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              {dados.partes.map(function(p, i, arr) {
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 80px 80px 80px', padding: '12px 20px', borderBottom: i < arr.length - 1 ? '1px solid ' + C.border : 'none', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: C.text }}>{p.nome}</div>
                      {p.comprou && <span style={{ fontSize: 11, color: C.gold, fontWeight: 600 }}>Comprou</span>}
                    </div>
                    <span style={{ fontSize: 13, color: C.text2, fontFamily: 'monospace' }}>{p.telefone}</span>
                    <span style={{ fontSize: 13, color: C.text3 }}>{p.eventos ? p.eventos.nome : '--'}</span>
                    <span style={{ fontSize: 13 }}>{p.checkin_at ? <span style={{ color: '#4ade80', fontWeight: 600 }}>✓</span> : <span style={{ color: C.text3 }}>—</span>}</span>
                    <span style={{ fontSize: 13, color: C.text3 }}>—</span>
                    <span style={{ fontSize: 13, color: C.text3 }}>—</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
