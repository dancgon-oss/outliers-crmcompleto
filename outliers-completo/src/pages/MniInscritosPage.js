import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, formatTel, formatCPF, unformatCPF, unformatTel, C, PARC_C } from '../lib/ui'
import { syncClienteAsaas, criarCobranca, gerarLinkWhatsApp } from '../lib/asaas'

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

function Badge({ status }) {
  var s = PARC_C[status] || PARC_C.Pendente
  return (
    <span style={{ background:s.bg, color:s.text, border:'1px solid '+s.border, padding:'2px 8px', borderRadius:9999, fontSize:10, fontWeight:600 }}>
      {status}
    </span>
  )
}

// Adiciona N meses a uma data ISO (YYYY-MM-DD) preservando o dia
function addMeses(iso, n) {
  if (!iso) return null
  var p = iso.split('-')
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
  d.setMonth(d.getMonth() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
}

export default function MniInscritosPage() {
  var [inscritos, setInscritos] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [filtroStatus, setFiltroStatus] = useState('Todos')
  var [showNovo, setShowNovo] = useState(false)
  var [salvandoNovo, setSalvandoNovo] = useState(false)
  var [novoForm, setNovoForm] = useState(formInicial())
  var [detalhe, setDetalhe] = useState(null)        // { cliente, financeiro, parcelas }
  var [carregandoDet, setCarregandoDet] = useState(false)
  var [emitindo, setEmitindo] = useState(null)      // parcelaId em emissão
  var [erroEmissao, setErroEmissao] = useState('')

  function formInicial() {
    return {
      nome:'', email:'', telefone:'', cpf:'', hunter:'',
      valor_total:'', desconto_pct:'', entrada:'', forma_entrada:'PIX',
      qtd_parcelas:'12', primeira_vencimento:'',
      observacoes:'',
    }
  }

  async function carregar() {
    setLoading(true)
    // Pega clientes do programa MNI + seu financeiro + parcelas
    var rc = await supabase.from('clientes')
      .select('id,nome,email,telefone,cpf,hunter,observacoes,asaas_customer_id,data_entrada')
      .eq('programa', 'MNI')
      .order('nome')
    var clientes = rc.data || []

    if (!clientes.length) { setInscritos([]); setLoading(false); return }
    var ids = clientes.map(function(c){ return c.id })

    var [rf, rp] = await Promise.all([
      supabase.from('financeiro').select('*').in('cliente_id', ids),
      supabase.from('parcelas').select('*').in('financeiro_id',
        // pega ids depois de saber finanças — substitui depois
        // workaround: filtramos no front
        []
      ),
    ])
    // Buscar parcelas pelos ids dos financeiros
    var finList = rf.data || []
    var finIds = finList.map(function(f){ return f.id })
    var rp2 = finIds.length
      ? await supabase.from('parcelas').select('*').in('financeiro_id', finIds).order('numero')
      : { data: [] }
    var parcelas = rp2.data || []

    // Agrupa
    var finByCli = {}
    finList.forEach(function(f){ finByCli[f.cliente_id] = f })
    var parcByFin = {}
    parcelas.forEach(function(p){
      if (!parcByFin[p.financeiro_id]) parcByFin[p.financeiro_id] = []
      parcByFin[p.financeiro_id].push(p)
    })

    var arr = clientes.map(function(c) {
      var fin = finByCli[c.id] || null
      var ps = fin ? (parcByFin[fin.id] || []) : []
      var pagas = ps.filter(function(x){ return x.status === 'Pago' })
      var atrasadas = ps.filter(function(x){ return x.status === 'Atrasado' })
      var recebido = pagas.reduce(function(s,x){ return s + Number(x.valor||0) }, 0)
      var aberto = ps.filter(function(x){ return x.status !== 'Pago' }).reduce(function(s,x){ return s + Number(x.valor||0) }, 0)
      return {
        cliente: c, financeiro: fin, parcelas: ps,
        _pagas: pagas.length, _total: ps.length, _atrasadas: atrasadas.length,
        _recebido: recebido, _aberto: aberto,
      }
    })
    setInscritos(arr)
    setLoading(false)
  }

  useEffect(function(){ carregar() }, [])

  // ─── Filtros + estatísticas ─────────────────────────────
  var lista = inscritos.filter(function(i) {
    if (search.trim()) {
      var s = search.toLowerCase()
      if (!(i.cliente.nome||'').toLowerCase().includes(s) &&
          !(i.cliente.email||'').toLowerCase().includes(s) &&
          !(i.cliente.hunter||'').toLowerCase().includes(s)) return false
    }
    if (filtroStatus === 'Em dia')      return i._atrasadas === 0 && i._pagas < i._total
    if (filtroStatus === 'Inadimplente') return i._atrasadas > 0
    if (filtroStatus === 'Quitado')     return i._total > 0 && i._pagas === i._total
    if (filtroStatus === 'Sem cobrança') return i._total === 0
    return true
  })

  var stats = inscritos.reduce(function(acc, i) {
    acc.recebido += i._recebido
    acc.aberto += i._aberto
    if (i._atrasadas > 0) acc.inadimplentes += 1
    if (i._total > 0 && i._pagas === i._total) acc.quitados += 1
    return acc
  }, { recebido:0, aberto:0, inadimplentes:0, quitados:0 })

  // ─── Novo inscrito ──────────────────────────────────────
  async function salvarNovo() {
    var f = novoForm
    if (!f.nome.trim()) { alert('Nome é obrigatório'); return }
    var valor = Number(f.valor_total)
    if (!valor || valor <= 0) { alert('Valor total inválido'); return }
    var qtd = parseInt(f.qtd_parcelas, 10) || 0
    if (qtd <= 0) { alert('Quantidade de parcelas inválida'); return }

    setSalvandoNovo(true)
    try {
      // 1) Cria/encontra cliente (origem MNI / programa MNI)
      var emailNorm = f.email.trim().toLowerCase()
      var cpfNorm = unformatCPF(f.cpf)
      var telNorm = unformatTel(f.telefone)
      var clienteId = null
      if (emailNorm) {
        var rEx = await supabase.from('clientes').select('id').ilike('email', emailNorm).maybeSingle()
        if (rEx.data) clienteId = rEx.data.id
      }
      if (!clienteId && cpfNorm) {
        var rEx2 = await supabase.from('clientes').select('id').eq('cpf', cpfNorm).maybeSingle()
        if (rEx2.data) clienteId = rEx2.data.id
      }
      if (clienteId) {
        await supabase.from('clientes').update({
          nome: f.nome,
          programa: 'MNI',
          origem: 'MNI',
          hunter: f.hunter || null,
          telefone: telNorm || null,
          cpf: cpfNorm || null,
          status: 'Ativo',
          observacoes: f.observacoes || null,
        }).eq('id', clienteId)
      } else {
        var rNew = await supabase.from('clientes').insert({
          nome: f.nome,
          email: emailNorm || null,
          telefone: telNorm || null,
          cpf: cpfNorm || null,
          hunter: f.hunter || null,
          programa: 'MNI',
          origem: 'MNI',
          status: 'Ativo',
          data_entrada: new Date().toISOString().slice(0,10),
          observacoes: f.observacoes || null,
        }).select('id').single()
        if (rNew.error) throw rNew.error
        clienteId = rNew.data.id
      }

      // 2) Calcula valores: bruto - desconto% = total. Entrada subtrai do total. Restante / qtd
      var descPct = Number(f.desconto_pct || 0)
      var valorLiquido = valor * (1 - descPct/100)
      var entrada = Number(f.entrada || 0)
      var restante = valorLiquido - entrada
      var valorParcela = Math.round((restante / qtd) * 100) / 100

      // 3) Cria financeiro
      var rFin = await supabase.from('financeiro').insert({
        cliente_id: clienteId,
        modalidade: qtd > 1 ? 'Parcelado' : 'À Vista',
        valor_total: valorLiquido,
        desconto: valor - valorLiquido,
        forma_pagamento: f.forma_entrada,
      }).select('id').single()
      if (rFin.error) throw rFin.error
      var finId = rFin.data.id

      // 4) Cria parcelas (entrada como parcela 0 ou inclui no fluxo? optaremos por incluir
      //    a entrada como parcela 1 paga, e as demais como parcelas seguintes)
      var parcelasInsert = []
      if (entrada > 0) {
        parcelasInsert.push({
          financeiro_id: finId,
          numero: 1,
          valor: entrada,
          vencimento: f.primeira_vencimento || new Date().toISOString().slice(0,10),
          status: 'Pago',
          pago_em: new Date().toISOString(),
        })
      }
      var base = f.primeira_vencimento || new Date().toISOString().slice(0,10)
      for (var i = 0; i < qtd; i++) {
        parcelasInsert.push({
          financeiro_id: finId,
          numero: (entrada > 0 ? 2 : 1) + i,
          valor: valorParcela,
          vencimento: addMeses(base, i + (entrada > 0 ? 1 : 0)),
          status: 'Pendente',
        })
      }
      if (parcelasInsert.length) {
        var rPar = await supabase.from('parcelas').insert(parcelasInsert)
        if (rPar.error) throw rPar.error
      }

      setShowNovo(false)
      setNovoForm(formInicial())
      await carregar()
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e))
    } finally {
      setSalvandoNovo(false)
    }
  }

  // ─── Detalhe + emissão Asaas ────────────────────────────
  async function abrirDetalhe(item) {
    setCarregandoDet(true)
    setErroEmissao('')
    // Recarrega financeiro + parcelas pra ter dados frescos
    var ps = []
    if (item.financeiro) {
      var rp = await supabase.from('parcelas').select('*').eq('financeiro_id', item.financeiro.id).order('numero')
      ps = rp.data || []
    }
    setDetalhe({ cliente: item.cliente, financeiro: item.financeiro, parcelas: ps })
    setCarregandoDet(false)
  }

  async function emitirCobranca(parcela, billingType) {
    if (!detalhe || !detalhe.cliente) return
    setEmitindo(parcela.id)
    setErroEmissao('')
    try {
      var clienteAsaas = detalhe.cliente.asaas_customer_id
      if (!clienteAsaas) {
        clienteAsaas = await syncClienteAsaas(detalhe.cliente)
        await supabase.from('clientes').update({ asaas_customer_id: clienteAsaas }).eq('id', detalhe.cliente.id)
        setDetalhe(function(p){ return { ...p, cliente: { ...p.cliente, asaas_customer_id: clienteAsaas } } })
      }
      var hoje = new Date().toISOString().slice(0,10)
      var venc = parcela.vencimento || hoje
      var resp = await criarCobranca({
        asaasCustomerId: clienteAsaas,
        billingType: billingType || 'UNDEFINED',
        valor: Number(parcela.valor),
        vencimento: venc,
        descricao: 'MNI - Parcela ' + parcela.numero + ' - ' + detalhe.cliente.nome,
        parcelaId: parcela.id,
      })
      // Atualiza parcela com dados do Asaas
      await supabase.from('parcelas').update({
        asaas_payment_id: resp.id,
        asaas_status: resp.status,
        asaas_boleto_url: resp.bankSlipUrl || null,
        asaas_invoice_url: resp.invoiceUrl || null,
      }).eq('id', parcela.id)
      // Recarrega detalhe
      var rp = await supabase.from('parcelas').select('*').eq('financeiro_id', detalhe.financeiro.id).order('numero')
      setDetalhe(function(p){ return { ...p, parcelas: rp.data || [] } })
      await carregar()
    } catch (e) {
      setErroEmissao(e.message || 'Erro ao emitir cobrança')
    } finally {
      setEmitindo(null)
    }
  }

  async function marcarParcela(parcela, novoStatus) {
    var patch = { status: novoStatus }
    if (novoStatus === 'Pago') patch.pago_em = new Date().toISOString()
    else patch.pago_em = null
    await supabase.from('parcelas').update(patch).eq('id', parcela.id)
    if (detalhe) {
      var rp = await supabase.from('parcelas').select('*').eq('financeiro_id', detalhe.financeiro.id).order('numero')
      setDetalhe(function(p){ return { ...p, parcelas: rp.data || [] } })
    }
    await carregar()
  }

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>🧠 MNI — Inscritos</div>
          <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Gestão dos alunos do Método Neuro Impacto. Valores, parcelamento e cobranças.</div>
        </div>
        <button onClick={function(){ setShowNovo(true) }}
          style={{ background:'#c9a96e', color:'#0a0900', border:'none', padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
          + Novo inscrito
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:20 }}>
        <Card label="Inscritos" value={inscritos.length} sub={stats.quitados + ' quitado(s)'} icon="👥" color={C.text} />
        <Card label="Recebido" value={fmt(stats.recebido)} sub="parcelas pagas" icon="✅" color={C.green} />
        <Card label="A receber" value={fmt(stats.aberto)} sub="parcelas em aberto" icon="⏳" color={C.gold} />
        <Card label="Inadimplentes" value={stats.inadimplentes} sub="com parcelas atrasadas" icon="⚠️" color={stats.inadimplentes ? C.red : C.text3} />
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <input placeholder="Buscar nome, email ou hunter..." value={search} onChange={function(e){ setSearch(e.target.value) }}
          style={{ ...inputStyle, flex:1, minWidth:240 }} />
        <select value={filtroStatus} onChange={function(e){ setFiltroStatus(e.target.value) }} style={{ ...inputStyle, width:180 }}>
          <option>Todos</option>
          <option>Em dia</option>
          <option>Inadimplente</option>
          <option>Quitado</option>
          <option>Sem cobrança</option>
        </select>
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:30, textAlign:'center', color:C.text3, fontStyle:'italic' }}>Carregando…</div>
        ) : lista.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:C.text3 }}>
            {inscritos.length === 0 ? 'Nenhum inscrito ainda. Clique em "Novo inscrito" pra começar.' : 'Nenhum resultado pros filtros.'}
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#0d0b06' }}>
                {['Nome','Hunter','Contato','Total','Parcelas','Recebido','Em aberto','Status',''].map(function(h,i){
                  return <th key={i} style={{ textAlign:'left', padding:'10px 12px', fontSize:10, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {lista.map(function(i) {
                var statusLbl = 'Sem cobrança'
                var statusColor = C.text3
                if (i._total > 0 && i._pagas === i._total) { statusLbl = 'Quitado'; statusColor = C.green }
                else if (i._atrasadas > 0) { statusLbl = 'Inadimplente'; statusColor = C.red }
                else if (i._total > 0) { statusLbl = 'Em dia'; statusColor = C.gold }
                return (
                  <tr key={i.cliente.id} style={{ borderTop:'1px solid #1c1810' }}>
                    <td style={{ padding:'10px 12px', color:C.text, fontWeight:500 }}>{i.cliente.nome}</td>
                    <td style={{ padding:'10px 12px', color:C.text2 }}>{i.cliente.hunter || '—'}</td>
                    <td style={{ padding:'10px 12px', color:C.text3, fontSize:12 }}>
                      <div>{formatTel(i.cliente.telefone) || '—'}</div>
                      <div>{i.cliente.email || '—'}</div>
                    </td>
                    <td style={{ padding:'10px 12px', color:C.text2 }}>{i.financeiro ? fmt(i.financeiro.valor_total) : '—'}</td>
                    <td style={{ padding:'10px 12px', color:C.text2 }}>{i._pagas}/{i._total}</td>
                    <td style={{ padding:'10px 12px', color:C.green }}>{fmt(i._recebido)}</td>
                    <td style={{ padding:'10px 12px', color:C.gold }}>{fmt(i._aberto)}</td>
                    <td style={{ padding:'10px 12px' }}>
                      <span style={{ background:statusColor+'22', color:statusColor, border:'1px solid '+statusColor, padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>{statusLbl}</span>
                    </td>
                    <td style={{ padding:'10px 12px', textAlign:'right' }}>
                      <button onClick={function(){ abrirDetalhe(i) }}
                        style={{ background:'#1c1810', border:'1px solid #2a2415', color:C.gold, padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        Ver parcelas
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Modal: Novo inscrito ──────────────────────── */}
      {showNovo && (
        <div onClick={function(){ if (!salvandoNovo) setShowNovo(false) }}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div onClick={function(e){ e.stopPropagation() }}
            style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:14, padding:24, width:680, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:18 }}>Novo inscrito MNI</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Nome*</label>
                <input value={novoForm.nome} onChange={function(e){ setNovoForm({ ...novoForm, nome: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Hunter (vendedor)</label>
                <input value={novoForm.hunter} onChange={function(e){ setNovoForm({ ...novoForm, hunter: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Email</label>
                <input type="email" value={novoForm.email} onChange={function(e){ setNovoForm({ ...novoForm, email: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>WhatsApp</label>
                <input value={novoForm.telefone} onChange={function(e){ setNovoForm({ ...novoForm, telefone: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>CPF</label>
                <input value={novoForm.cpf} onChange={function(e){ setNovoForm({ ...novoForm, cpf: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
              <div></div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Valor bruto*</label>
                <input type="number" step="0.01" value={novoForm.valor_total} onChange={function(e){ setNovoForm({ ...novoForm, valor_total: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} placeholder="13216.00" />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Desconto (%)</label>
                <input type="number" step="0.01" value={novoForm.desconto_pct} onChange={function(e){ setNovoForm({ ...novoForm, desconto_pct: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} placeholder="10" />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Entrada (R$)</label>
                <input type="number" step="0.01" value={novoForm.entrada} onChange={function(e){ setNovoForm({ ...novoForm, entrada: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} placeholder="1956.40" />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Forma da entrada</label>
                <select value={novoForm.forma_entrada} onChange={function(e){ setNovoForm({ ...novoForm, forma_entrada: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }}>
                  <option>PIX</option><option>Cartão</option><option>Boleto</option><option>Asaas</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Qtd parcelas*</label>
                <input type="number" min="1" value={novoForm.qtd_parcelas} onChange={function(e){ setNovoForm({ ...novoForm, qtd_parcelas: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>1º vencimento</label>
                <input type="date" value={novoForm.primeira_vencimento} onChange={function(e){ setNovoForm({ ...novoForm, primeira_vencimento: e.target.value }) }} style={{ ...inputStyle, width:'100%', marginTop:4 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.06em' }}>Observações</label>
              <textarea value={novoForm.observacoes} onChange={function(e){ setNovoForm({ ...novoForm, observacoes: e.target.value }) }}
                rows={3} style={{ ...inputStyle, width:'100%', marginTop:4, resize:'vertical' }} />
            </div>
            {/* Preview de cálculo */}
            <div style={{ background:'#0a0900', border:'1px dashed #2a2415', borderRadius:8, padding:12, marginTop:14, fontSize:12, color:C.text2 }}>
              {(function(){
                var v = Number(novoForm.valor_total||0)
                var dp = Number(novoForm.desconto_pct||0)
                var vl = v * (1 - dp/100)
                var ent = Number(novoForm.entrada||0)
                var rest = vl - ent
                var q = parseInt(novoForm.qtd_parcelas, 10) || 0
                var par = q > 0 ? rest/q : 0
                return (
                  <>
                    <div>Líquido: <b>{fmt(vl)}</b> ({fmt(v)} - {dp}%)</div>
                    <div>Restante após entrada: <b>{fmt(rest)}</b></div>
                    <div>Cada parcela: <b>{fmt(par)}</b> × {q}x</div>
                  </>
                )
              })()}
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:18 }}>
              <button disabled={salvandoNovo} onClick={function(){ setShowNovo(false) }}
                style={{ background:'transparent', border:'1px solid #2a2415', color:C.text3, padding:'10px 18px', borderRadius:8, fontSize:13, cursor:'pointer' }}>
                Cancelar
              </button>
              <button disabled={salvandoNovo} onClick={salvarNovo}
                style={{ background:'#c9a96e', color:'#0a0900', border:'none', padding:'10px 18px', borderRadius:8, fontSize:13, fontWeight:600, cursor: salvandoNovo ? 'wait' : 'pointer', opacity: salvandoNovo ? 0.6 : 1 }}>
                {salvandoNovo ? 'Salvando…' : 'Salvar inscrito'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Detalhe + parcelas ───────────────────── */}
      {detalhe && (
        <div onClick={function(){ if (!emitindo) setDetalhe(null) }}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div onClick={function(e){ e.stopPropagation() }}
            style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:14, padding:24, width:900, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
              <div>
                <div style={{ fontSize:18, fontWeight:700, color:C.text }}>{detalhe.cliente.nome}</div>
                <div style={{ fontSize:12, color:C.text3, marginTop:4 }}>
                  {formatTel(detalhe.cliente.telefone)} {detalhe.cliente.email ? ' • ' + detalhe.cliente.email : ''} {detalhe.cliente.hunter ? ' • Hunter: ' + detalhe.cliente.hunter : ''}
                </div>
              </div>
              <button onClick={function(){ setDetalhe(null) }} style={{ background:'none', border:'none', color:C.text3, fontSize:20, cursor:'pointer' }}>×</button>
            </div>

            {erroEmissao && (
              <div style={{ background:'#7f1d1d22', border:'1px solid #7f1d1d', borderRadius:8, padding:10, color:'#fca5a5', fontSize:12, marginBottom:14 }}>
                {erroEmissao}
              </div>
            )}

            {carregandoDet ? (
              <div style={{ color:C.text3, fontStyle:'italic' }}>Carregando…</div>
            ) : !detalhe.financeiro ? (
              <div style={{ color:C.text3, fontStyle:'italic' }}>Esse inscrito ainda não tem registro financeiro. Edite o cadastro pra adicionar valor e parcelas.</div>
            ) : (
              <>
                <div style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:8, padding:14, marginBottom:14, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, fontSize:12 }}>
                  <div><div style={{ color:C.text3, fontSize:10, textTransform:'uppercase' }}>Valor total</div><div style={{ color:C.text, fontWeight:600, fontSize:15, marginTop:2 }}>{fmt(detalhe.financeiro.valor_total)}</div></div>
                  <div><div style={{ color:C.text3, fontSize:10, textTransform:'uppercase' }}>Forma entrada</div><div style={{ color:C.text2, marginTop:2 }}>{detalhe.financeiro.forma_pagamento}</div></div>
                  <div><div style={{ color:C.text3, fontSize:10, textTransform:'uppercase' }}>Modalidade</div><div style={{ color:C.text2, marginTop:2 }}>{detalhe.financeiro.modalidade}</div></div>
                  <div><div style={{ color:C.text3, fontSize:10, textTransform:'uppercase' }}>Asaas</div><div style={{ color: detalhe.cliente.asaas_customer_id ? C.green : C.text3, fontSize:11, marginTop:2 }}>{detalhe.cliente.asaas_customer_id ? '✓ Sincronizado' : 'Não sincronizado'}</div></div>
                </div>

                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#0d0b06' }}>
                      {['#','Vencimento','Valor','Status','Asaas','Ações'].map(function(h,i){
                        return <th key={i} style={{ textAlign:'left', padding:'8px 10px', fontSize:10, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</th>
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.parcelas.map(function(p) {
                      var podeEmitir = !p.asaas_payment_id && p.status !== 'Pago'
                      var linkPagar = p.asaas_invoice_url || p.asaas_boleto_url
                      return (
                        <tr key={p.id} style={{ borderTop:'1px solid #1c1810' }}>
                          <td style={{ padding:'8px 10px', color:C.text2, fontFamily:'monospace' }}>{p.numero}</td>
                          <td style={{ padding:'8px 10px', color:C.text2 }}>{fmtDate(p.vencimento)}</td>
                          <td style={{ padding:'8px 10px', color:C.text }}>{fmt(p.valor)}</td>
                          <td style={{ padding:'8px 10px' }}><Badge status={p.status} /></td>
                          <td style={{ padding:'8px 10px', color:C.text3, fontSize:11 }}>
                            {p.asaas_payment_id ? (
                              <>
                                <div>ID: {p.asaas_payment_id.slice(0,12)}…</div>
                                {linkPagar && <a href={linkPagar} target="_blank" rel="noreferrer" style={{ color:C.gold, fontSize:11 }}>Abrir fatura ↗</a>}
                              </>
                            ) : '—'}
                          </td>
                          <td style={{ padding:'8px 10px' }}>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                              {podeEmitir && (
                                <>
                                  <button disabled={emitindo===p.id} onClick={function(){ emitirCobranca(p, 'BOLETO') }} title="Emitir boleto"
                                    style={{ background:'#1c1810', border:'1px solid #2a2415', color:C.gold, padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>
                                    Boleto
                                  </button>
                                  <button disabled={emitindo===p.id} onClick={function(){ emitirCobranca(p, 'PIX') }} title="Emitir PIX"
                                    style={{ background:'#1c1810', border:'1px solid #2a2415', color:C.gold, padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>
                                    PIX
                                  </button>
                                  <button disabled={emitindo===p.id} onClick={function(){ emitirCobranca(p, 'UNDEFINED') }} title="Asaas escolhe (boleto+pix+cartão)"
                                    style={{ background:'#1c1810', border:'1px solid #2a2415', color:C.gold, padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>
                                    Asaas
                                  </button>
                                </>
                              )}
                              {p.status !== 'Pago' ? (
                                <button onClick={function(){ marcarParcela(p, 'Pago') }}
                                  style={{ background:'#14532d22', border:'1px solid #14532d', color:C.green, padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>
                                  ✓ Pago
                                </button>
                              ) : (
                                <button onClick={function(){ marcarParcela(p, 'Pendente') }}
                                  style={{ background:'transparent', border:'1px solid #2a2415', color:C.text3, padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer' }}>
                                  Desfazer
                                </button>
                              )}
                              {linkPagar && detalhe.cliente.telefone && (
                                <a href={gerarLinkWhatsApp(detalhe.cliente.telefone, detalhe.cliente.nome, fmt(p.valor), fmtDate(p.vencimento), linkPagar)} target="_blank" rel="noreferrer"
                                  style={{ background:'#14532d22', border:'1px solid #14532d', color:C.green, padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', textDecoration:'none' }}>
                                  WhatsApp
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
