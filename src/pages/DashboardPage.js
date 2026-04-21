import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, diasAteVencer, C } from '../lib/ui'

function KPICard({ label, value, sub, color, icon, onClick }) {
  return (
    <div onClick={onClick}
      style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8, cursor: onClick ? 'pointer' : 'default', transition: 'border-color .15s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        {icon && <div style={{ fontSize: 22 }}>{icon}</div>}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || C.text, letterSpacing: '-0.03em' }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: C.text3 }}>{sub}</div>}
    </div>
  )
}

export default function DashboardPage({ onNav }) {
  var [stats, setStats] = useState({ clientes: 0, ativos: 0, inad: 0, recebido: 0, pendente: 0, atrasado: 0, eventos: 0, participantes: 0 })
  var [alertas, setAlertas] = useState([])
  var [receitaMensal, setReceitaMensal] = useState([])
  var [eventosProximos, setEventosProximos] = useState([])
  var [loading, setLoading] = useState(true)

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    try {
      var [rc, rp, rev, rpart] = await Promise.all([
        supabase.from('clientes').select('id,status,created_at'),
        supabase.from('parcelas').select('id,valor,status,vencimento'),
        supabase.from('eventos').select('*').order('data_inicio', { ascending: false }).limit(20),
        supabase.from('participantes').select('id,evento_id,checkin_at,comprou'),
      ])

      var clientes = rc.data || []
      var parcelas = rp.data || []
      var eventos  = rev.data || []
      var partes   = rpart.data || []

      var ativos   = clientes.filter(function(c){ return c.status === 'Ativo' }).length
      var inad     = clientes.filter(function(c){ return c.status === 'Inadimplente' }).length
      var recebido = parcelas.filter(function(p){ return p.status === 'Pago' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)
      var pendente = parcelas.filter(function(p){ return p.status === 'Pendente' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)
      var atrasado = parcelas.filter(function(p){ return p.status === 'Atrasado' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)

      var hoje = new Date()
      var proximos = eventos.filter(function(ev) {
        var d = new Date(ev.data_inicio + 'T00:00:00')
        return d >= hoje || ev.status === 'Em Andamento'
      }).slice(0, 4)

      setStats({ clientes: clientes.length, ativos, inad, recebido, pendente, atrasado, eventos: eventos.length, participantes: partes.length })
      setEventosProximos(proximos)

      // Alertas
      var lista = []
      parcelas.forEach(function(p) {
        if (p.status === 'Pago') return
        var dias = diasAteVencer(p.vencimento)
        if (dias !== null && dias <= 7) lista.push({ ...p, dias })
      })
      lista.sort(function(a,b){ return (a.dias||0) - (b.dias||0) })
      setAlertas(lista.slice(0, 10))

      // Receita 6 meses
      var meses = []
      for (var i = 5; i >= 0; i--) {
        var d2 = new Date()
        d2.setMonth(d2.getMonth() - i)
        var m = d2.getMonth(), y = d2.getFullYear()
        var nome = d2.toLocaleString('pt-BR', { month: 'short' }).replace('.','')
        var total = parcelas
          .filter(function(p) {
            if (p.status !== 'Pago' || !p.vencimento) return false
            var pv = new Date(p.vencimento + 'T00:00:00')
            return pv.getMonth() === m && pv.getFullYear() === y
          })
          .reduce(function(s,p){ return s + Number(p.valor) }, 0)
        meses.push({ nome, total })
      }
      setReceitaMensal(meses)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  var maxMes = receitaMensal.reduce(function(m,r){ return r.total > m ? r.total : m }, 1)

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: C.bg, fontFamily: 'Inter, sans-serif' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: '-0.03em' }}>Dashboard</div>
        <div style={{ fontSize: 14, color: C.text3, marginTop: 5 }}>Visão geral do negócio · {new Date().toLocaleDateString('pt-BR', {weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
      </div>

      {loading ? (
        <div style={{ color: C.text3, fontStyle: 'italic', fontSize: 15 }}>Carregando...</div>
      ) : (<>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
          <KPICard label="Total Clientes"   value={stats.clientes}           sub={stats.ativos + ' ativos · ' + stats.inad + ' inadimplentes'} icon="👥" onClick={function(){onNav('clientes')}} />
          <KPICard label="Receita Total"    value={fmt(stats.recebido + stats.pendente)} sub="faturado"  icon="💰" color={C.gold} />
          <KPICard label="Recebido"         value={fmt(stats.recebido)}      sub="já pago pelos clientes" icon="✅" color="#4ade80" />
          <KPICard label="A Receber"        value={fmt(stats.pendente)}      sub={stats.atrasado > 0 ? fmt(stats.atrasado) + ' em atraso' : 'sem atrasos'} icon={stats.atrasado > 0 ? '🔴' : '⏳'} color={stats.atrasado > 0 ? C.red : C.text} />
        </div>

        {/* Segunda linha */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
          <KPICard label="Inadimplentes"  value={stats.inad}         sub="clientes em atraso"    icon="⚠️" color={stats.inad > 0 ? C.red : C.text} onClick={function(){onNav('clientes')}} />
          <KPICard label="Eventos"        value={stats.eventos}      sub="cadastrados"            icon="📅" onClick={function(){onNav('eventos')}} />
          <KPICard label="Participantes"  value={stats.participantes} sub="em todos os eventos"   icon="🎟️" onClick={function(){onNav('eventos')}} />
        </div>

        {/* Gráfico + Alertas + Eventos */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginBottom: 20 }}>

          {/* Receita mensal */}
          <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 20 }}>Receita dos Últimos 6 Meses</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 150 }}>
              {receitaMensal.map(function(m, i) {
                var pct = maxMes > 0 ? (m.total / maxMes) : 0
                var h = Math.max(pct * 130, m.total > 0 ? 10 : 3)
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>{m.total > 0 ? fmt(m.total).replace('R$','').trim() : ''}</div>
                    <div style={{ width: '100%', height: h, background: m.total > 0 ? 'linear-gradient(180deg,#c9a96e,#a07840)' : C.border, borderRadius: '4px 4px 0 0', transition: 'height .4s' }} />
                    <div style={{ fontSize: 12, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>{m.nome}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Alertas vencimento */}
          <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>⚡ Alertas de Vencimento</div>
            {alertas.length === 0 ? (
              <div style={{ color: C.text3, fontSize: 14, fontStyle: 'italic', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Nenhuma parcela vencendo em breve ✓</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
                {alertas.map(function(a) {
                  var atrasado = a.dias < 0
                  var hoje = a.dias === 0
                  var cor = atrasado ? '#fca5a5' : hoje ? C.yellow : C.text2
                  var label = atrasado ? (Math.abs(a.dias) + 'd atraso') : hoje ? 'Hoje' : (a.dias + 'd')
                  return (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: C.bgHover, borderRadius: 8, border: '1px solid ' + C.border }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{fmt(a.valor)}</div>
                        <div style={{ fontSize: 12, color: C.text3 }}>{fmtDate(a.vencimento)}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: cor, background: cor + '22', padding: '3px 9px', borderRadius: 6 }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            )}
            <button onClick={function(){ onNav('financeiro') }}
              style={{ marginTop: 14, width: '100%', background: 'none', border: '1px solid ' + C.border, color: C.text3, padding: '9px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              Ver financeiro completo →
            </button>
          </div>
        </div>

        {/* Próximos eventos */}
        {eventosProximos.length > 0 && (
          <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>📅 Próximos Eventos</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {eventosProximos.map(function(ev) {
                var statusC = { Planejado: { color: '#60a5fa' }, 'Em Andamento': { color: '#4ade80' }, Encerrado: { color: '#7a6a4a' } }[ev.status] || { color: C.text3 }
                return (
                  <div key={ev.id} style={{ background: C.bgHover, border: '1px solid ' + C.border, borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 12, color: statusC.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{ev.status}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>{ev.nome}</div>
                    <div style={{ fontSize: 13, color: C.text3 }}>{fmtDate(ev.data_inicio)}{ev.data_fim ? ' – ' + fmtDate(ev.data_fim) : ''}</div>
                    {ev.local && <div style={{ fontSize: 12, color: C.text3, marginTop: 3 }}>📍 {ev.local}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </>)}
    </div>
  )
}
