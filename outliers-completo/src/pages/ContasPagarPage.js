import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, C } from '../lib/ui'

var STATUS_C = {
  Pendente:  { bg: '#78350f22', border: '#78350f', text: '#fbbf24' },
  Pago:      { bg: '#14532d22', border: '#14532d', text: '#4ade80' },
  Atrasado:  { bg: '#7f1d1d22', border: '#7f1d1d', text: '#fca5a5' },
  Cancelado: { bg: '#1c1810',   border: '#2a2415', text: '#7a6a4a' },
}

var CATEGORIAS = [
  'Salários e prestadores',
  'Marketing',
  'Software',
  'Infraestrutura',
  'Aluguel',
  'Equipamento',
  'Impostos',
  'Bancário',
  'Outras',
]

var inputStyle = {
  background:'#0a0900', border:'1px solid #2a2415', borderRadius:6,
  padding:'8px 12px', color:'#f0ead8', fontSize:13, fontFamily:'Inter,sans-serif',
  outline:'none', width:'100%',
}
var btnPrimary = {
  background:'linear-gradient(180deg,#c9a96e,#a07840)', border:'none', color:'#1a1a1a',
  padding:'8px 14px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'Inter,sans-serif',
}
var btnGhost = {
  background:'#1c1810', border:'1px solid #2a2415', color:'#a08658',
  padding:'6px 10px', borderRadius:6, cursor:'pointer', fontSize:12, fontFamily:'Inter,sans-serif',
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>{label}</label>
      {children}
    </div>
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

export default function ContasPagarPage(props) {
  var origem = props && props.origem  // 'Outliers' | 'Storydoing' | undefined (mostra tudo)
  var auth = useAuth()
  var podeEditar = auth.isAdmin || auth.isFinanceiro
  var [contas, setContas] = useState([])
  var [loading, setLoading] = useState(true)
  var [filtroStatus, setFiltroStatus] = useState('Todos')
  var [filtroCategoria, setFiltroCategoria] = useState('Todas')
  var [search, setSearch] = useState('')

  var [showModal, setShowModal] = useState(false)
  var [editing, setEditing] = useState(null)
  var [form, setForm] = useState(emptyForm())
  var [saving, setSaving] = useState(false)

  // Comissões a pagar
  var [comissoesPagar, setComissoesPagar] = useState([])

  async function carregarComissoes() {
    // Comissões dos cursos só aparecem quando NÃO há filtro de origem (ou origem=Outliers)
    if (origem === 'Storydoing') { setComissoesPagar([]); return }
    var r = await supabase.from('vw_comissoes_resumo').select('*').gt('valor_a_pagar', 0).order('beneficiario_nome', { ascending: true })
    if (r.error) {
      // fallback: query direta
      var r2 = await supabase.from('comissoes').select('id, valor_total, valor_liberado, valor_pago, status, beneficiario:beneficiario_id(id,nome,pix), cliente:cliente_id(nome)')
      var lista = (r2.data || []).map(function(c) {
        var aPagar = Number(c.valor_liberado||0) - Number(c.valor_pago||0)
        return {
          id: c.id,
          beneficiario_id: c.beneficiario && c.beneficiario.id,
          beneficiario_nome: c.beneficiario && c.beneficiario.nome,
          beneficiario_pix: c.beneficiario && c.beneficiario.pix,
          cliente_nome: c.cliente && c.cliente.nome,
          valor_a_pagar: aPagar,
          valor_total: c.valor_total,
          valor_pago: c.valor_pago,
          status: c.status,
        }
      }).filter(function(x){ return Number(x.valor_a_pagar) > 0 })
      setComissoesPagar(lista)
    } else {
      setComissoesPagar((r.data || []).filter(function(x){ return Number(x.valor_a_pagar||0) > 0 }))
    }
  }
  useEffect(function(){ carregarComissoes() }, [])

  async function pagarComissao(c) {
    var aPagar = Number(c.valor_a_pagar || 0)
    if (aPagar <= 0) return
    // Busca PIX do beneficiário
    var pix = c.beneficiario_pix
    if (!pix && c.beneficiario_id) {
      var rp = await supabase.from('profiles').select('pix').eq('id', c.beneficiario_id).maybeSingle()
      pix = rp.data && rp.data.pix
    }
    var info = 'Beneficiário: ' + (c.beneficiario_nome || '?') + '\n'
    info += 'Cliente da venda: ' + (c.cliente_nome || '—') + '\n'
    info += 'A pagar: ' + fmt(aPagar) + '\n'
    if (pix) info += 'PIX: ' + pix + '\n'
    info += '\nValor a pagar agora (vazio = total):'
    var input = window.prompt(info, aPagar.toFixed(2))
    if (input === null) return
    var v = input.trim() === '' ? aPagar : Number(input.replace(',', '.'))
    if (isNaN(v) || v <= 0) { alert('Valor inválido.'); return }
    if (v > aPagar + 0.01) { alert('Maior que o disponível.'); return }
    if (pix && navigator.clipboard) {
      try { await navigator.clipboard.writeText(pix) } catch(_e) {}
    }
    var obs = window.prompt('Observação (opcional):' + (pix ? '\n\nPIX copiado para a área de transferência.' : ''), '') || null
    var rIns = await supabase.from('comissao_movimentos').insert({
      comissao_id: c.id, tipo: 'pagamento', valor: v, descricao: obs,
    })
    if (rIns.error) { alert('Erro: ' + rIns.error.message); return }
    var novoPago = Number(c.valor_pago || 0) + v
    var novoStatus = (novoPago >= Number(c.valor_total || 0) - 0.01) ? 'Quitada' : 'Aberta'
    await supabase.from('comissoes').update({ valor_pago: novoPago, status: novoStatus, updated_at: new Date().toISOString() }).eq('id', c.id)
    await carregarComissoes()
  }

  function emptyForm() {
    return {
      descricao:'', fornecedor:'', categoria:'', valor:'', vencimento:'',
      forma_pagamento:'', observacoes:'', recorrente: false,
    }
  }

  async function carregar() {
    setLoading(true)
    try { await supabase.rpc('atualizar_contas_atrasadas') } catch (_e) {}
    var q = supabase.from('contas_pagar').select('*').order('vencimento', { ascending: true })
    if (origem) q = q.eq('origem', origem)
    var r = await q
    setContas(r.data || [])
    setLoading(false)
  }
  useEffect(function() { carregar() }, [origem])

  function abrirNova() {
    setEditing(null); setForm(emptyForm()); setShowModal(true)
  }
  function abrirEdicao(c) {
    setEditing(c)
    setForm({
      descricao: c.descricao || '',
      fornecedor: c.fornecedor || '',
      categoria: c.categoria || '',
      valor: String(c.valor || ''),
      vencimento: c.vencimento ? String(c.vencimento).slice(0,10) : '',
      forma_pagamento: c.forma_pagamento || '',
      observacoes: c.observacoes || '',
      recorrente: !!c.recorrente,
    })
    setShowModal(true)
  }

  async function salvar() {
    if (!form.descricao.trim()) { alert('Descrição obrigatória.'); return }
    var v = Number((form.valor||'').toString().replace(',', '.'))
    if (isNaN(v) || v <= 0) { alert('Valor inválido.'); return }
    if (!form.vencimento) { alert('Vencimento obrigatório.'); return }
    setSaving(true)
    var payload = {
      descricao: form.descricao.trim(),
      fornecedor: form.fornecedor.trim() || null,
      categoria: form.categoria || null,
      valor: v,
      vencimento: form.vencimento,
      forma_pagamento: form.forma_pagamento || null,
      observacoes: form.observacoes.trim() || null,
      recorrente: !!form.recorrente,
    }
    if (origem) payload.origem = origem
    if (!editing) payload.criado_por = auth.profile && auth.profile.id

    var r
    if (editing) r = await supabase.from('contas_pagar').update(payload).eq('id', editing.id)
    else        r = await supabase.from('contas_pagar').insert(payload)
    setSaving(false)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    setShowModal(false); setEditing(null); setForm(emptyForm())
    carregar()
  }

  async function pagar(c) {
    var hoje = new Date().toISOString().slice(0,10)
    var dataPag = window.prompt('Data do pagamento (AAAA-MM-DD):', hoje)
    if (!dataPag) return
    var r = await supabase.from('contas_pagar').update({
      status: 'Pago', pago_em: dataPag, updated_at: new Date().toISOString()
    }).eq('id', c.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    carregar()
  }

  async function reverterPagamento(c) {
    if (!window.confirm('Reverter pagamento e voltar para Pendente?')) return
    var r = await supabase.from('contas_pagar').update({
      status: 'Pendente', pago_em: null, updated_at: new Date().toISOString()
    }).eq('id', c.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    carregar()
  }

  async function excluir(c) {
    if (!window.confirm('Excluir conta "' + c.descricao + '"?')) return
    var r = await supabase.from('contas_pagar').delete().eq('id', c.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    carregar()
  }

  var filtradas = contas.filter(function(c) {
    if (filtroStatus !== 'Todos' && c.status !== filtroStatus) return false
    if (filtroCategoria !== 'Todas' && (c.categoria || '') !== filtroCategoria) return false
    if (search) {
      var s = search.toLowerCase()
      if (!(c.descricao||'').toLowerCase().includes(s)
       && !(c.fornecedor||'').toLowerCase().includes(s)
       && !(c.observacoes||'').toLowerCase().includes(s)) return false
    }
    return true
  })

  var contasPendentes = contas.filter(function(c){ return c.status === 'Pendente' }).reduce(function(s,c){ return s + Number(c.valor) }, 0)
  var comissoesAPagarTotal = (comissoesPagar||[]).reduce(function(s,c){ return s + Number(c.valor_a_pagar||0) }, 0)
  var totalPendente = contasPendentes + comissoesAPagarTotal
  var totalAtrasado = contas.filter(function(c){ return c.status === 'Atrasado' }).reduce(function(s,c){ return s + Number(c.valor) }, 0)
  var totalPagoMes = contas.filter(function(c){
    if (c.status !== 'Pago' || !c.pago_em) return false
    var d = new Date(c.pago_em); var hoje = new Date()
    return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth()
  }).reduce(function(s,c){ return s + Number(c.valor) }, 0)
  var totalAVencer7d = contas.filter(function(c){
    if (c.status !== 'Pendente') return false
    var d = new Date(c.vencimento); var hoje = new Date()
    var diff = (d - hoje) / (1000*60*60*24)
    return diff >= 0 && diff <= 7
  }).reduce(function(s,c){ return s + Number(c.valor) }, 0)

  return (
    <div style={{ padding:'24px 28px', overflowY:'auto', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color:C.text, letterSpacing:'-0.02em' }}>Contas a Pagar</div>
          <div style={{ fontSize:13, color:C.text3, marginTop:4 }}>Cadastre, acompanhe e marque como pagas as despesas do negócio.</div>
        </div>
        {podeEditar && <button style={btnPrimary} onClick={abrirNova}>+ Nova conta</button>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:20 }}>
        <Card label="Pendente" value={fmt(totalPendente)}
              sub={contasPendentes > 0 || comissoesAPagarTotal > 0
                    ? fmt(contasPendentes) + ' contas · ' + fmt(comissoesAPagarTotal) + ' comissões'
                    : 'aguardando pagamento'}
              icon="⏳" color={C.gold} />
        <Card label="Atrasado" value={fmt(totalAtrasado)} sub="contas vencidas" icon="⚠️" color="#fca5a5" />
        <Card label="Vence em 7 dias" value={fmt(totalAVencer7d)} sub="atenção" icon="🔔" color="#fbbf24" />
        <Card label="Pago este mês" value={fmt(totalPagoMes)} sub="já quitado no mês" icon="✅" color="#4ade80" />
      </div>

      {/* COMISSÕES A PAGAR (a vendedores) */}
      {comissoesPagar.length > 0 && (
        <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, marginBottom:20, padding:'16px 20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em' }}>🤝 Comissões a pagar</div>
              <div style={{ fontSize:11, color:'#7a6a4a', marginTop:3 }}>Comissões liberadas pelo pagamento de parcelas — a transferir aos vendedores</div>
            </div>
            <div style={{ fontSize:18, fontWeight:700, color:C.gold }}>
              {fmt(comissoesPagar.reduce(function(s,c){ return s + Number(c.valor_a_pagar||0) }, 0))}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#0d0b06' }}>
                  {['Beneficiário','Cliente da venda','Total','Pago','A pagar','Ação'].map(function(h,i){
                    return <th key={i} style={{ textAlign:'left', padding:'10px 12px', fontSize:10, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</th>
                  })}
                </tr>
              </thead>
              <tbody>
                {comissoesPagar.map(function(c) {
                  return (
                    <tr key={c.id} style={{ borderTop:'1px solid #1c1810' }}>
                      <td style={{ padding:'10px 12px', color:C.text, fontWeight:500 }}>{c.beneficiario_nome || '—'}</td>
                      <td style={{ padding:'10px 12px', color:C.text2 }}>{c.cliente_nome || '—'}</td>
                      <td style={{ padding:'10px 12px', color:C.text2 }}>{fmt(c.valor_total)}</td>
                      <td style={{ padding:'10px 12px', color:'#4ade80' }}>{fmt(c.valor_pago)}</td>
                      <td style={{ padding:'10px 12px', color:C.gold, fontWeight:600 }}>{fmt(c.valor_a_pagar)}</td>
                      <td style={{ padding:'10px 12px' }}>
                        {podeEditar && (
                          <button onClick={function(){ pagarComissao(c) }} style={{ ...btnPrimary, padding:'5px 10px', fontSize:11 }}>💸 Pagar</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <input style={{ ...inputStyle, flex:'1 1 200px', minWidth:160 }} placeholder="Buscar..." value={search} onChange={function(e){ setSearch(e.target.value) }} />
        <select style={{ ...inputStyle, width:160 }} value={filtroStatus} onChange={function(e){ setFiltroStatus(e.target.value) }}>
          {['Todos','Pendente','Atrasado','Pago','Cancelado'].map(function(s){ return <option key={s}>{s}</option> })}
        </select>
        <select style={{ ...inputStyle, width:200 }} value={filtroCategoria} onChange={function(e){ setFiltroCategoria(e.target.value) }}>
          <option>Todas</option>
          {CATEGORIAS.map(function(c){ return <option key={c}>{c}</option> })}
        </select>
      </div>

      <div style={{ background:'#141209', border:'1px solid #1c1810', borderRadius:12, overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:24, color:C.text3, fontStyle:'italic' }}>Carregando...</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding:24, color:C.text3, fontStyle:'italic', textAlign:'center' }}>Nenhuma conta encontrada.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#0d0b06' }}>
                {['Descrição','Categoria','Fornecedor','Vencimento','Valor','Status','Pago em','Ações'].map(function(h,i){
                  return <th key={i} style={{ textAlign:'left', padding:'12px 14px', fontSize:10, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {filtradas.map(function(c) {
                var pc = STATUS_C[c.status] || STATUS_C.Pendente
                return (
                  <tr key={c.id} style={{ borderTop:'1px solid #1c1810' }}>
                    <td style={{ padding:'12px 14px', color:C.text }}>
                      <div style={{ fontWeight:500 }}>{c.descricao}</div>
                      {c.observacoes && <div style={{ fontSize:11, color:C.text3, marginTop:2 }}>{c.observacoes}</div>}
                    </td>
                    <td style={{ padding:'12px 14px', color:C.text2 }}>{c.categoria || '—'}</td>
                    <td style={{ padding:'12px 14px', color:C.text2 }}>{c.fornecedor || '—'}</td>
                    <td style={{ padding:'12px 14px', color:C.text2, fontFamily:'monospace' }}>{fmtDate(c.vencimento)}</td>
                    <td style={{ padding:'12px 14px', fontWeight:600, color:C.text }}>{fmt(c.valor)}</td>
                    <td style={{ padding:'12px 14px' }}>
                      <span style={{ background:pc.bg, border:'1px solid '+pc.border, color:pc.text, padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>{c.status}</span>
                    </td>
                    <td style={{ padding:'12px 14px', color:C.text3, fontFamily:'monospace' }}>{c.pago_em ? fmtDate(c.pago_em) : '—'}</td>
                    <td style={{ padding:'12px 14px', whiteSpace:'nowrap', textAlign:'right' }}>
                      {podeEditar && c.status !== 'Pago' && c.status !== 'Cancelado' && (
                        <button style={{ ...btnGhost, color:'#4ade80', borderColor:'#14532d', marginRight:6 }} onClick={function(){ pagar(c) }}>✓ Pagar</button>
                      )}
                      {podeEditar && c.status === 'Pago' && (
                        <button style={{ ...btnGhost, marginRight:6 }} onClick={function(){ reverterPagamento(c) }}>↶ Reverter</button>
                      )}
                      {podeEditar && (
                        <button style={{ ...btnGhost, marginRight:6 }} onClick={function(){ abrirEdicao(c) }}>✎</button>
                      )}
                      {auth.isAdmin && (
                        <button style={{ ...btnGhost, color:'#fca5a5', borderColor:'#7f1d1d' }} onClick={function(){ excluir(c) }}>🗑️</button>
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
        <div onClick={function(){ if(!saving) setShowModal(false) }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209', border:'1px solid #2a2415', borderRadius:12, padding:24, width:560, maxWidth:'92vw', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#c9a96e', textTransform:'uppercase', letterSpacing:'.08em' }}>{editing ? 'Editar conta' : 'Nova conta'}</div>
              <button onClick={function(){ if(!saving) setShowModal(false) }} style={{ background:'none', border:'none', color:'#7a6a4a', fontSize:20, cursor:'pointer' }}>×</button>
            </div>

            <Field label="Descrição*">
              <input style={inputStyle} value={form.descricao} onChange={function(e){ setForm(function(p){ return { ...p, descricao: e.target.value } }) }} placeholder="Ex.: Anúncios Facebook" />
            </Field>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Fornecedor">
                <input style={inputStyle} value={form.fornecedor} onChange={function(e){ setForm(function(p){ return { ...p, fornecedor: e.target.value } }) }} />
              </Field>
              <Field label="Categoria">
                <select style={inputStyle} value={form.categoria} onChange={function(e){ setForm(function(p){ return { ...p, categoria: e.target.value } }) }}>
                  <option value="">—</option>
                  {CATEGORIAS.map(function(c){ return <option key={c} value={c}>{c}</option> })}
                </select>
              </Field>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="Valor (R$)*">
                <input type="number" step="0.01" style={inputStyle} value={form.valor} onChange={function(e){ setForm(function(p){ return { ...p, valor: e.target.value } }) }} />
              </Field>
              <Field label="Vencimento*">
                <input type="date" style={inputStyle} value={form.vencimento} onChange={function(e){ setForm(function(p){ return { ...p, vencimento: e.target.value } }) }} />
              </Field>
            </div>

            <Field label="Forma de pagamento">
              <select style={inputStyle} value={form.forma_pagamento} onChange={function(e){ setForm(function(p){ return { ...p, forma_pagamento: e.target.value } }) }}>
                <option value="">—</option>
                <option>PIX</option>
                <option>Boleto</option>
                <option>Cartão</option>
                <option>Transferência</option>
                <option>Dinheiro</option>
                <option>Outro</option>
              </select>
            </Field>

            <Field label="Observações">
              <textarea style={{ ...inputStyle, resize:'vertical' }} rows={2} value={form.observacoes} onChange={function(e){ setForm(function(p){ return { ...p, observacoes: e.target.value } }) }} />
            </Field>

            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:C.text3, marginBottom:14 }}>
              <input type="checkbox" checked={form.recorrente} onChange={function(e){ setForm(function(p){ return { ...p, recorrente: e.target.checked } }) }} />
              Conta recorrente (mensal)
            </label>

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button style={btnGhost} onClick={function(){ setShowModal(false) }} disabled={saving}>Cancelar</button>
              <button style={btnPrimary} onClick={salvar} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
