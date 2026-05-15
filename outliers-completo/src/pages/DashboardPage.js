import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, diasAteVencer, C } from '../lib/ui'

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: C.text3, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
        {icon && <div style={{ fontSize: 20 }}>{icon}</div>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.text3 }}>{sub}</div>}
    </div>
  )
}

export default function DashboardPage({ onNav }) {
  var auth = useAuth()
  var verFin = auth.canSeeFinanceiro    // admin + financeiro só
  var [stats, setStats] = useState({ clientes: 0, ativos: 0, inad: 0, recebido: 0, pendente: 0, atrasado: 0, comissaoPagar: 0, comissaoPagaMes: 0, comissaoTotalLiberada: 0 })
  var [alertas, setAlertas] = useState([])
  var [receitaMensal, setReceitaMensal] = useState([])
  var [loading, setLoading] = useState(true)

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    try {
      var [rc, rp, rf, rcom, rmov] = await Promise.all([
        supabase.from('clientes').select('id,status,created_at'),
        supabase.from('parcelas').select('id,valor,status,vencimento,financeiro_id'),
        supabase.from('financeiro').select('id,cliente_id'),
        supabase.from('comissoes').select('id,valor_total,valor_liberado,valor_pago,status'),
        supabase.from('comissao_movimentos').select('valor,tipo,created_at'),
      ])

      var clientes = rc.data || []
      var parcelas = rp.data || []
      var comissoes = rcom.data || []
      var movs = rmov.data || []

      var ativos = clientes.filter(function(c){ return c.status === 'Ativo' }).length
      var inad   = clientes.filter(function(c){ return c.status === 'Inadimplente' }).length
      var recebido = parcelas.filter(function(p){ return p.status === 'Pago' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)
      var pendente = parcelas.filter(function(p){ return p.status === 'Pendente' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)
      var atrasado = parcelas.filter(function(p){ return p.status === 'Atrasado' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)

      // Comissões
      var totalLiberada = comissoes.reduce(function(s,c){ return s + Number(c.valor_liberado||0) }, 0)
      var totalPaga = comissoes.reduce(function(s,c){ return s + Number(c.valor_pago||0) }, 0)
      var comissaoPagar = totalLiberada - totalPaga
      var hojeRef = new Date()
      var comissaoPagaMes = movs.filter(function(m){
        if (m.tipo !== 'pagamento' || !m.created_at) return false
        var d = new Date(m.created_at)
        return d.getFullYear() === hojeRef.getFullYear() && d.getMonth() === hojeRef.getMonth()
      }).reduce(function(s,m){ return s + Number(m.valor) }, 0)

      setStats({ clientes: clientes.length, ativos: ativos, inad: inad, recebido: recebido, pendente: pendente, atrasado: atrasado, comissaoPagar: comissaoPagar, comissaoPagaMes: comissaoPagaMes, comissaoTotalLiberada: totalLiberada })

      // Alertas: parcelas vencendo em até 5 dias ou atrasadas
      var alertasList = []
      var hoje = new Date(); hoje.setHours(0,0,0,0)
      parcelas.forEach(function(p) {
        if (p.status === 'Pago') return
        var dias = diasAteVencer(p.vencimento)
        if (dias !== null && dias <= 5) {
          alertasList.push({ ...p, dias: dias })
        }
      })
      alertasList.sort(function(a,b){ return (a.dias||0) - (b.dias||0) })
      setAlertas(alertasList.slice(0, 8))

      // Receita dos últimos 6 meses
      var meses = []
      for (var i = 5; i >= 0; i--) {
        var d = new Date()
        d.setMonth(d.getMonth() - i)
        var m = d.getMonth()
        var y = d.getFullYear()
        var nome = d.toLocaleString('pt-BR', { month: 'short' })
        var total = parcelas
          .filter(function(p) {
            if (p.status !== 'Pago' || !p.vencimento) return false
            var pv = new Date(p.vencimento + 'T00:00:00')
            return pv.getMonth() === m && pv.getFullYear() === y
          })
          .reduce(function(s,p){ return s + Number(p.valor) }, 0)
        meses.push({ nome: nome.replace('.',''), total: total })
      }
      setReceitaMensal(meses)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  var maxMes = receitaMensal.reduce(function(m,r){ return r.total > m ? r.total : m }, 1)

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: C.bg, fontFamily: 'Inter,sans-serif' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>Dashboard</div>
        <div style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>Visao geral do negocio</div>
      </div>

      {loading ? (
        <div style={{ color: C.text3, fontStyle: 'italic' }}>Carregando...</div>
      ) : (<>

        {/* KPI Cards — financeiros só pra admin/financeiro */}
        <div style={{ display: 'grid', gridTemplateColumns: verFin ? 'repeat(3,1fr)' : 'repeat(2,1fr)', gap: 16, marginBottom: 28 }}>
          <StatCard label="Total Clientes"  value={stats.clientes} sub={stats.ativos + ' ativos'}           icon="👥" />
          <StatCard label="Inadimplentes"   value={stats.inad}     sub="clientes em atraso"                  icon="⚠️" color={stats.inad > 0 ? C.red : C.text} />
          {verFin && <>
            <StatCard label="Receita Total"   value={fmt(stats.recebido + stats.pendente)} sub="faturado"      icon="💰" color={C.gold} />
            <StatCard label="Recebido"        value={fmt(stats.recebido)}  sub="ja pago pelos clientes"        icon="✅" color="#4ade80" />
            <StatCard label="A Receber"       value={fmt(stats.pendente)}  sub="parcelas pendentes"            icon="⏳" />
            <StatCard label="Em Atraso"       value={fmt(stats.atrasado)}  sub="parcelas atrasadas"            icon="🔴" color={stats.atrasado > 0 ? C.red : C.text} />
          </>}
        </div>

        {/* Comissões */}
        {verFin && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 28 }}>
            <StatCard label="Comissões a pagar"  value={fmt(stats.comissaoPagar)} sub="liberadas, ainda não pagas"  icon="🤝" color={stats.comissaoPagar > 0 ? C.gold : C.text} />
            <StatCard label="Comissões pagas no mês" value={fmt(stats.comissaoPagaMes)} sub="já transferidas neste mês" icon="📤" color="#4ade80" />
            <StatCard label="Total liberado"     value={fmt(stats.comissaoTotalLiberada)} sub="já gerado por parcelas pagas" icon="📊" />
          </div>
        )}

        {/* Charts + Alertas (financeiros — só pra quem pode ver R$) */}
        {verFin && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>

          {/* Receita mensal */}
          <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 20 }}>Receita dos Ultimos 6 Meses</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140 }}>
              {receitaMensal.map(function(m, i) {
                var pct = maxMes > 0 ? (m.total / maxMes) : 0
                var h = Math.max(pct * 120, m.total > 0 ? 8 : 2)
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 10, color: C.text3 }}>{m.total > 0 ? fmt(m.total).replace('R$','').trim() : ''}</div>
                    <div style={{ width: '100%', height: h, background: m.total > 0 ? 'linear-gradient(180deg,#c9a96e,#a07840)' : C.border, borderRadius: 4, transition: 'height .4s' }} />
                    <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.nome}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Alertas */}
          <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '22px 24px', overflow: 'hidden' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>Alertas de Vencimento</div>
            {alertas.length === 0 ? (
              <div style={{ color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhuma parcela vencendo em breve.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {alertas.map(function(a) {
                  var atrasado = a.dias < 0
                  var hoje = a.dias === 0
                  var cor = atrasado ? '#fca5a5' : hoje ? C.yellow : C.text2
                  var label = atrasado ? (Math.abs(a.dias) + 'd atrasado') : hoje ? 'Vence hoje' : ('Vence em ' + a.dias + 'd')
                  return (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: C.bgHover, borderRadius: 8, border: '1px solid ' + C.border }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{fmt(a.valor)}</div>
                        <div style={{ fontSize: 11, color: C.text3 }}>{fmtDate(a.vencimento)}</div>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: cor, background: cor + '22', padding: '3px 8px', borderRadius: 6 }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            )}
            <button onClick={function(){ onNav('crm') }} style={{ marginTop: 14, width: '100%', background: 'none', border: '1px solid ' + C.border, color: C.text3, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter,sans-serif', transition: 'all .15s' }}>
              Ver todos os clientes →
            </button>
          </div>
        </div>
        )}

        {/* Atalho pra vendedores irem pro Pipeline (sem widgets financeiros) */}
        {!verFin && (
          <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Atalhos rápidos</div>
            <div style={{ fontSize: 12, color: C.text3, marginBottom: 14 }}>Acesso direto às frentes comerciais.</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={function(){ onNav('pipeline') }} style={{ background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '10px 18px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Ver Pipeline →
              </button>
              <button onClick={function(){ onNav('clientes') }} style={{ background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '10px 18px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, cursor: 'pointer' }}>
                Lista de clientes
              </button>
              <button onClick={function(){ onNav('eventos') }} style={{ background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '10px 18px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, cursor: 'pointer' }}>
                Eventos
              </button>
            </div>
          </div>
        )}
      </>)}
    </div>
  )
}
