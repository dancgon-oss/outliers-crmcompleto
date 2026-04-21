import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, diasAteVencer, C, PARC_C, ASAAS_STATUS_PT, INPUT_S, BTN_PRIMARY, BTN_GHOST, LABEL_S, CARD_S, OVERLAY_S, MODAL_S } from '../lib/ui'
import { syncClienteAsaas, criarCobranca, buscarPixQrCode, gerarLinkWhatsApp } from '../lib/asaas'

export default function FinanceiroPage() {
  var [clientes, setClientes] = useState([])
  var [selected, setSelected] = useState(null)
  var [financeiro, setFinanceiro] = useState(null)
  var [loading, setLoading] = useState(true)
  var [loadingDet, setLoadingDet] = useState(false)
  var [search, setSearch] = useState('')
  var [filtroStatus, setFiltroStatus] = useState('Todos')
  var [filtroParcela, setFiltroParcela] = useState('Todos')
  var [showCobranca, setShowCobranca] = useState(null)
  var [cobrancaResult, setCobrancaResult] = useState(null)
  var [cobrancaBilling, setCobrancaBilling] = useState('UNDEFINED')
  var [cobrancaLoading, setCobrancaLoading] = useState(false)
  var [cobrancaErr, setCobrancaErr] = useState('')
  var [stats, setStats] = useState({ recebido: 0, pendente: 0, atrasado: 0, totalClientes: 0 })
  var [editParcela, setEditParcela] = useState(null)
  var [editFinanceiro, setEditFinanceiro] = useState(false)
  var [formFin, setFormFin] = useState({})
  var [savingEdit, setSavingEdit] = useState(false)
  var [modalNovoFin, setModalNovoFin] = useState(false)
  var [formNovoFin, setFormNovoFin] = useState({ modalidade:'Parcelado', num_parcelas:6, valor_total:'', desconto:'0', forma_pagamento:'Asaas' })

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var [rc, rf] = await Promise.all([
      supabase.from('clientes').select('id,nome,email,telefone,cpf,status,asaas_customer_id').order('nome'),
      supabase.from('financeiro').select('*, parcelas(*)')
    ])
    var fins = rf.data || [], clis = rc.data || []
    var finMap = {}
    fins.forEach(function(f) { finMap[f.cliente_id] = f })
    var rec = 0, pend = 0, atra = 0
    fins.forEach(function(f) {
      ;(f.parcelas || []).forEach(function(p) {
        if (p.status === 'Pago') rec += Number(p.valor)
        else if (p.status === 'Atrasado') atra += Number(p.valor)
        else pend += Number(p.valor)
      })
    })
    setStats({ recebido: rec, pendente: pend, atrasado: atra, totalClientes: clis.length })
    var listagem = clis.map(function(c) {
      var fin = finMap[c.id] || null
      var parcelas = fin ? (fin.parcelas || []) : []
      var totalPago = parcelas.filter(function(p) { return p.status === 'Pago' }).reduce(function(s, p) { return s + Number(p.valor) }, 0)
      var totalLiq = fin ? (Number(fin.valor_total) - Number(fin.desconto)) : 0
      var temAtrasado = parcelas.some(function(p) { return p.status === 'Atrasado' })
      var temPendente = parcelas.some(function(p) { return p.status === 'Pendente' })
      return { ...c, fin: fin, totalPago: totalPago, totalLiq: totalLiq, temAtrasado: temAtrasado, temPendente: temPendente }
    })
    setClientes(listagem)
    setLoading(false)
  }

  async function selecionarCliente(c) {
    setSelected(c); setLoadingDet(true); setEditFinanceiro(false); setEditParcela(null)
    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', c.id).maybeSingle()
    setFinanceiro(fin || null)
    setLoadingDet(false)
  }

  async function recarregarFin() {
    if (!selected) return
    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
    setFinanceiro(fin || null)
    await carregar()
  }

  async function salvarEdicaoParcela() {
    if (!editParcela) return
    setSavingEdit(true)
    await supabase.from('parcelas').update({ valor: Number(editParcela.valor), vencimento: editParcela.vencimento || null, status: editParcela.status }).eq('id', editParcela.id)
    setSavingEdit(false); setEditParcela(null); recarregarFin()
  }

  async function salvarEdicaoFinanceiro() {
    if (!financeiro) return
    setSavingEdit(true)
    await supabase.from('financeiro').update({ modalidade: formFin.modalidade, valor_total: Number(formFin.valor_total), desconto: Number(formFin.desconto), forma_pagamento: formFin.forma_pagamento }).eq('id', financeiro.id)
    setSavingEdit(false); setEditFinanceiro(false); recarregarFin()
  }

  async function criarFinanceiro() {
    if (!selected || !formNovoFin.valor_total) return
    setSavingEdit(true)
    var n = formNovoFin.modalidade === 'A Vista' ? 1 : Number(formNovoFin.num_parcelas)
    var liq = Number(formNovoFin.valor_total) - Number(formNovoFin.desconto)
    var vlr = parseFloat((liq / n).toFixed(2))
    var rf = await supabase.from('financeiro').insert({ cliente_id: selected.id, modalidade: formNovoFin.modalidade, valor_total: Number(formNovoFin.valor_total), desconto: Number(formNovoFin.desconto), forma_pagamento: formNovoFin.forma_pagamento }).select().single()
    if (rf.data) {
      await supabase.from('parcelas').insert(Array.from({ length: n }, function(_, i) { return { financeiro_id: rf.data.id, numero: i + 1, valor: vlr, status: 'Pendente' } }))
    }
    setSavingEdit(false); setModalNovoFin(false); recarregarFin()
  }

  async function emitirCobranca() {
    if (!showCobranca || !selected) return
    setCobrancaLoading(true); setCobrancaErr('')
    try {
      var asaasId = await syncClienteAsaas(selected)
      if (!selected.asaas_customer_id) await supabase.from('clientes').update({ asaas_customer_id: asaasId }).eq('id', selected.id)
      var cob = await criarCobranca({ asaasCustomerId: asaasId, valor: showCobranca.valor, vencimento: showCobranca.vencimento || new Date().toISOString().split('T')[0], descricao: 'Outliers - Parcela ' + showCobranca.numero, billingType: cobrancaBilling, parcelaId: showCobranca.id })
      var pixData = null
      if ((cobrancaBilling === 'PIX' || cobrancaBilling === 'UNDEFINED') && cob.id) {
        try { pixData = await buscarPixQrCode(cob.id) } catch (e) {}
      }
      await supabase.from('parcelas').update({ asaas_payment_id: cob.id, asaas_status: cob.status, asaas_invoice_url: cob.invoiceUrl, asaas_boleto_url: cob.bankSlipUrl, asaas_pix_copia_cola: pixData ? pixData.payload : null }).eq('id', showCobranca.id)
      setCobrancaResult({ ...cob, pixData: pixData })
      recarregarFin()
    } catch (e) { setCobrancaErr(e.message || 'Erro ao emitir cobranca') }
    setCobrancaLoading(false)
  }

  var filtrados = clientes.filter(function(c) {
    var ms = !search || c.nome.toLowerCase().includes(search.toLowerCase()) || (c.telefone || '').includes(search)
    var mst = filtroStatus === 'Todos' || c.status === filtroStatus
    var mp = filtroParcela === 'Todos'
      || (filtroParcela === 'Atrasado' && c.temAtrasado)
      || (filtroParcela === 'Pendente' && c.temPendente)
      || (filtroParcela === 'Quitado' && c.totalLiq > 0 && c.totalPago >= c.totalLiq)
      || (filtroParcela === 'Sem Financeiro' && !c.fin)
    return ms && mst && mp
  })

  var S = { inp: INPUT_S, btnG: BTN_PRIMARY, btnGhost: BTN_GHOST, lbl: LABEL_S, card: CARD_S, overlay: OVERLAY_S, modal: MODAL_S }

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter,sans-serif', background: C.bg }}>

      <div style={{ width: selected ? 360 : '100%', borderRight: selected ? '1px solid ' + C.border : 'none', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '1px solid ' + C.border }}>
          {[
            { l: 'Recebido', v: fmt(stats.recebido), color: '#4ade80' },
            { l: 'Pendente', v: fmt(stats.pendente), color: '#fbbf24' },
            { l: 'Atrasado', v: fmt(stats.atrasado), color: '#f87171' },
            { l: 'Clientes', v: stats.totalClientes, color: C.gold },
          ].map(function(s, i) {
            return (
              <div key={i} style={{ padding: '15px 0', borderRight: i < 3 ? '1px solid ' + C.border : 'none', textAlign: 'center', background: '#0d0b06' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.v}</div>
                <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 3 }}>{s.l}</div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + C.border, display: 'flex', gap: 8, flexWrap: 'wrap', background: '#0d0b06' }}>
          <input style={{ ...S.inp, flex: 1, minWidth: 140 }} placeholder="Buscar cliente..." value={search} onChange={function(e) { setSearch(e.target.value) }} />
          <select style={{ ...S.inp, width: 130 }} value={filtroStatus} onChange={function(e) { setFiltroStatus(e.target.value) }}>
            {['Todos','Ativo','Inadimplente','Concluido','Inativo'].map(function(s) { return <option key={s}>{s}</option> })}
          </select>
          <select style={{ ...S.inp, width: 150 }} value={filtroParcela} onChange={function(e) { setFiltroParcela(e.target.value) }}>
            {['Todos','Atrasado','Pendente','Quitado','Sem Financeiro'].map(function(s) { return <option key={s}>{s}</option> })}
          </select>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 15 }}>Carregando...</div>}
          {!loading && filtrados.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 15, fontStyle: 'italic' }}>Nenhum cliente encontrado.</div>}
          {filtrados.map(function(c) {
            var pct = c.totalLiq > 0 ? Math.round(c.totalPago / c.totalLiq * 100) : 0
            var active = selected && selected.id === c.id
            return (
              <div key={c.id} onClick={function() { selecionarCliente(c) }}
                style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.border, background: active ? C.bgHover : 'transparent', cursor: 'pointer', transition: 'background .1s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 2 }}>{c.nome}</div>
                    <div style={{ fontSize: 12, color: C.text3 }}>{c.telefone || c.email || '--'}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    {c.temAtrasado && <span style={{ fontSize: 11, fontWeight: 600, color: '#f87171', background: '#7f1d1d22', padding: '2px 7px', borderRadius: 20 }}>Atrasado</span>}
                    {!c.temAtrasado && c.temPendente && <span style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', background: '#78350f22', padding: '2px 7px', borderRadius: 20 }}>Pendente</span>}
                    {!c.temAtrasado && !c.temPendente && c.totalLiq > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', background: '#14532d22', padding: '2px 7px', borderRadius: 20 }}>Quitado</span>}
                    {!c.fin && <span style={{ fontSize: 11, color: C.text3, padding: '2px 7px', borderRadius: 20, border: '1px solid ' + C.border }}>Sem fin.</span>}
                  </div>
                </div>
                {c.totalLiq > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#4ade80', fontWeight: 600 }}>{fmt(c.totalPago)}</span>
                      <span style={{ fontSize: 12, color: C.text3 }}>{fmt(c.totalLiq)} ({pct}%)</span>
                    </div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: pct + '%', height: '100%', background: pct === 100 ? '#4ade80' : 'linear-gradient(90deg,#c9a96e,#a07840)', borderRadius: 2, transition: 'width .4s' }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 24px', borderBottom: '1px solid ' + C.border, background: '#0d0b06', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{selected.nome}</div>
              <div style={{ fontSize: 13, color: C.text3, marginTop: 3 }}>{selected.email}{selected.email && selected.telefone ? ' · ' : ''}{selected.telefone}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!financeiro && !loadingDet && <button style={{ ...S.btnG, padding: '8px 14px', fontSize: 13 }} onClick={function() { setFormNovoFin({ modalidade:'Parcelado', num_parcelas:6, valor_total:'', desconto:'0', forma_pagamento:'Asaas' }); setModalNovoFin(true) }}>+ Criar Financeiro</button>}
              <button style={S.btnGhost} onClick={function() { setSelected(null); setFinanceiro(null) }}>✕</button>
            </div>
          </div>

          <div style={{ padding: 24, flex: 1 }}>
            {loadingDet && <div style={{ color: C.text3, fontSize: 15 }}>Carregando...</div>}
            {!loadingDet && !financeiro && (
              <div style={{ textAlign: 'center', padding: 50, color: C.text3, fontSize: 15 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
                Sem financeiro. Clique em "+ Criar Financeiro" acima.
              </div>
            )}

            {!loadingDet && financeiro && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                <div style={{ ...S.card, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Resumo</span>
                    <button style={{ ...S.btnGhost, fontSize: 12, padding: '5px 12px' }} onClick={function() { setFormFin({ modalidade: financeiro.modalidade, valor_total: financeiro.valor_total, desconto: financeiro.desconto, forma_pagamento: financeiro.forma_pagamento }); setEditFinanceiro(true) }}>✏️ Editar</button>
                  </div>
                  {editFinanceiro ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div><label style={S.lbl}>Modalidade</label><select style={S.inp} value={formFin.modalidade} onChange={function(e) { setFormFin(function(p) { return { ...p, modalidade: e.target.value } }) }}><option>Parcelado</option><option>A Vista</option></select></div>
                        <div><label style={S.lbl}>Pagamento</label><select style={S.inp} value={formFin.forma_pagamento} onChange={function(e) { setFormFin(function(p) { return { ...p, forma_pagamento: e.target.value } }) }}><option>Asaas</option><option>PIX</option><option>Cartao</option><option>Boleto</option></select></div>
                        <div><label style={S.lbl}>Valor Total</label><input style={S.inp} type="number" value={formFin.valor_total} onChange={function(e) { setFormFin(function(p) { return { ...p, valor_total: e.target.value } }) }} /></div>
                        <div><label style={S.lbl}>Desconto</label><input style={S.inp} type="number" value={formFin.desconto} onChange={function(e) { setFormFin(function(p) { return { ...p, desconto: e.target.value } }) }} /></div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={S.btnGhost} onClick={function() { setEditFinanceiro(false) }} disabled={savingEdit}>Cancelar</button>
                        <button style={S.btnG} onClick={salvarEdicaoFinanceiro} disabled={savingEdit}>{savingEdit ? 'Salvando...' : 'Salvar'}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                      {[
                        { l: 'Valor Total', v: fmt(financeiro.valor_total) },
                        { l: 'Desconto', v: fmt(financeiro.desconto), red: true },
                        { l: 'Liquido', v: fmt(financeiro.valor_total - financeiro.desconto), gold: true },
                        { l: 'Modalidade', v: financeiro.modalidade },
                      ].map(function(f, i) {
                        return (
                          <div key={i} style={{ background: C.bgHover, borderRadius: 8, padding: '12px 14px', cursor: 'pointer' }} onClick={function() { setFormFin({ modalidade: financeiro.modalidade, valor_total: financeiro.valor_total, desconto: financeiro.desconto, forma_pagamento: financeiro.forma_pagamento }); setEditFinanceiro(true) }}>
                            <div style={S.lbl}>{f.l}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: f.gold ? C.gold : f.red ? C.red : C.text }}>{f.v}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {(function() {
                  var pagas = (financeiro.parcelas || []).filter(function(p) { return p.status === 'Pago' }).reduce(function(s, p) { return s + Number(p.valor) }, 0)
                  var liq = financeiro.valor_total - financeiro.desconto
                  var pct = liq > 0 ? Math.round(pagas / liq * 100) : 0
                  return (
                    <div style={{ ...S.card, padding: '14px 18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, color: C.text3 }}>Progresso de Pagamento</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: pct === 100 ? '#4ade80' : C.gold }}>{pct}%</span>
                      </div>
                      <div style={{ height: 8, background: C.border, borderRadius: 4 }}>
                        <div style={{ width: pct + '%', height: '100%', background: pct === 100 ? '#4ade80' : 'linear-gradient(90deg,#c9a96e,#a07840)', borderRadius: 4, transition: 'width .5s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                        <span style={{ fontSize: 13, color: '#4ade80', fontWeight: 600 }}>Recebido: {fmt(pagas)}</span>
                        <span style={{ fontSize: 13, color: '#fbbf24' }}>Restante: {fmt(liq - pagas)}</span>
                      </div>
                    </div>
                  )
                })()}

                <div style={S.card}>
                  <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Parcelas — {financeiro.modalidade} — {financeiro.forma_pagamento}</span>
                    <span style={{ fontSize: 12, color: C.text3 }}>{(financeiro.parcelas || []).filter(function(p) { return p.status === 'Pago' }).length}/{(financeiro.parcelas || []).length} pagas</span>
                  </div>
                  {(financeiro.parcelas || []).map(function(p, i, arr) {
                    var pc = PARC_C[p.status] || PARC_C['Pendente']
                    var dias = diasAteVencer(p.vencimento)
                    var alertCor = p.status !== 'Pago' && dias !== null && dias <= 3 ? (dias < 0 ? '#f87171' : '#fbbf24') : null
                    var editing = editParcela && editParcela.id === p.id
                    return (
                      <div key={p.id} style={{ padding: '13px 18px', borderBottom: i < arr.length - 1 ? '1px solid ' + C.border : 'none' }}>
                        {editing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                              <div><label style={{ ...S.lbl, marginBottom: 4 }}>Valor (R$)</label><input style={S.inp} type="number" value={editParcela.valor} onChange={function(e) { setEditParcela(function(prev) { return { ...prev, valor: e.target.value } }) }} /></div>
                              <div><label style={{ ...S.lbl, marginBottom: 4 }}>Vencimento</label><input style={S.inp} type="date" value={editParcela.vencimento || ''} onChange={function(e) { setEditParcela(function(prev) { return { ...prev, vencimento: e.target.value } }) }} /></div>
                              <div><label style={{ ...S.lbl, marginBottom: 4 }}>Status</label><select style={S.inp} value={editParcela.status} onChange={function(e) { setEditParcela(function(prev) { return { ...prev, status: e.target.value } }) }}><option>Pago</option><option>Pendente</option><option>Atrasado</option></select></div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button style={{ ...S.btnGhost, fontSize: 12, padding: '6px 12px' }} onClick={function() { setEditParcela(null) }}>Cancelar</button>
                              <button style={{ ...S.btnG, fontSize: 12, padding: '6px 14px' }} onClick={salvarEdicaoParcela} disabled={savingEdit}>{savingEdit ? '...' : 'Salvar'}</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: C.text3, width: 24, fontFamily: 'monospace' }}>{String(p.numero).padStart(2, '0')}</span>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: 18, fontWeight: 600, color: C.text }}>{fmt(p.valor)}</span>
                              {p.vencimento && <span style={{ fontSize: 13, color: alertCor || C.text3, marginLeft: 10, fontFamily: 'monospace' }}>{fmtDate(p.vencimento)}{alertCor && dias < 0 ? ' (' + Math.abs(dias) + 'd atraso)' : alertCor ? ' (' + dias + 'd)' : ''}</span>}
                            </div>
                            {p.asaas_status && <span style={{ fontSize: 11, color: C.text3, background: C.bgHover, padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace' }}>{ASAAS_STATUS_PT[p.asaas_status] || p.asaas_status}</span>}
                            <span style={{ fontSize: 12, fontWeight: 600, color: pc.text, background: pc.bg, border: '1px solid ' + pc.border, padding: '3px 9px', borderRadius: 6, cursor: 'pointer' }}
                              onClick={function() { setEditParcela({ id: p.id, valor: p.valor, vencimento: p.vencimento || '', status: p.status, numero: p.numero }) }}>
                              {p.status} ✏️
                            </span>
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              {p.asaas_invoice_url && <a href={p.asaas_invoice_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.gold, textDecoration: 'none', background: C.bgHover, padding: '4px 9px', borderRadius: 6, border: '1px solid ' + C.border }}>Fatura</a>}
                              {p.asaas_pix_copia_cola && <button onClick={function() { navigator.clipboard.writeText(p.asaas_pix_copia_cola) }} style={{ fontSize: 12, color: C.gold, background: C.bgHover, border: '1px solid ' + C.border, padding: '4px 9px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Copiar PIX</button>}
                              {selected.telefone && p.asaas_invoice_url && <a href={gerarLinkWhatsApp(selected.telefone, selected.nome, fmt(p.valor), fmtDate(p.vencimento), p.asaas_invoice_url)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#4ade80', textDecoration: 'none', background: '#14532d22', padding: '4px 9px', borderRadius: 6, border: '1px solid #14532d' }}>WhatsApp</a>}
                              {p.status !== 'Pago' && <button onClick={function() { setShowCobranca(p); setCobrancaResult(null); setCobrancaErr(''); setCobrancaBilling('UNDEFINED') }} style={{ ...S.btnG, padding: '4px 10px', fontSize: 12 }}>{p.asaas_payment_id ? 'Reemitir' : '+ Cobrar'}</button>}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showCobranca && (
        <div style={S.overlay} onClick={function() { if (!cobrancaLoading) { setShowCobranca(null); setCobrancaResult(null) } }}>
          <div style={{ ...S.modal, width: 520 }} onClick={function(e) { e.stopPropagation() }}>
            {!cobrancaResult ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 6 }}>Emitir Cobranca</div>
                <div style={{ fontSize: 14, color: C.gold, marginBottom: 20 }}>{selected && selected.nome} — Parcela {showCobranca.numero} · {fmt(showCobranca.valor)}</div>
                <label style={S.lbl}>Forma de Pagamento</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8, marginBottom: 18 }}>
                  {[['UNDEFINED','🔀','Cliente escolhe'],['PIX','⚡','PIX'],['BOLETO','🧾','Boleto'],['CREDIT_CARD','💳','Cartao']].map(function(t) {
                    return (
                      <div key={t[0]} onClick={function() { setCobrancaBilling(t[0]) }}
                        style={{ border: '1.5px solid ' + (cobrancaBilling === t[0] ? C.gold : C.border), borderRadius: 8, padding: '13px 14px', cursor: 'pointer', background: cobrancaBilling === t[0] ? C.bgHover : '#0d0b06', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{t[1]}</span>
                        <span style={{ fontSize: 14, color: cobrancaBilling === t[0] ? C.gold : C.text2, fontWeight: cobrancaBilling === t[0] ? 600 : 400 }}>{t[2]}</span>
                      </div>
                    )
                  })}
                </div>
                {cobrancaErr && <div style={{ background: '#7f1d1d22', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 13px', fontSize: 13, borderRadius: 8, marginBottom: 14 }}>{cobrancaErr}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button style={S.btnGhost} onClick={function() { setShowCobranca(null) }}>Cancelar</button>
                  <button style={S.btnG} onClick={emitirCobranca} disabled={cobrancaLoading}>{cobrancaLoading ? 'Emitindo...' : 'Emitir Cobranca'}</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Cobranca Emitida!</div>
                </div>
                {cobrancaResult.invoiceUrl && (
                  <div style={{ ...S.card, padding: '14px 16px', marginBottom: 12 }}>
                    <label style={S.lbl}>Link da Fatura</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, fontSize: 12, color: C.text3, wordBreak: 'break-all', fontFamily: 'monospace' }}>{cobrancaResult.invoiceUrl}</div>
                      <button style={{ ...S.btnGhost, padding: '5px 10px', fontSize: 12 }} onClick={function() { navigator.clipboard.writeText(cobrancaResult.invoiceUrl) }}>Copiar</button>
                    </div>
                    {selected && selected.telefone && (
                      <a href={gerarLinkWhatsApp(selected.telefone, selected.nome, fmt(showCobranca.valor), fmtDate(showCobranca.vencimento), cobrancaResult.invoiceUrl)} target="_blank" rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13, color: '#4ade80', textDecoration: 'none', background: '#14532d22', padding: '8px 14px', borderRadius: 6, border: '1px solid #14532d' }}>
                        Enviar por WhatsApp
                      </a>
                    )}
                  </div>
                )}
                {cobrancaResult.pixData && cobrancaResult.pixData.encodedImage && (
                  <div style={{ ...S.card, padding: '14px 16px', marginBottom: 12 }}>
                    <label style={S.lbl}>PIX QR Code</label>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8 }}>
                      <img src={'data:image/png;base64,' + cobrancaResult.pixData.encodedImage} alt="QR PIX" style={{ width: 90, height: 90, background: '#fff', borderRadius: 4 }} />
                      <button style={{ ...S.btnGhost, fontSize: 12, padding: '7px 12px' }} onClick={function() { navigator.clipboard.writeText(cobrancaResult.pixData.payload) }}>Copiar Codigo PIX</button>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                  <button style={S.btnG} onClick={function() { setShowCobranca(null); setCobrancaResult(null) }}>Fechar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modalNovoFin && (
        <div style={S.overlay} onClick={function() { if (!savingEdit) setModalNovoFin(false) }}>
          <div style={{ ...S.modal, width: 480 }} onClick={function(e) { e.stopPropagation() }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 6 }}>Criar Financeiro</div>
            <div style={{ fontSize: 14, color: C.gold, marginBottom: 20 }}>{selected && selected.nome}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={S.lbl}>Modalidade</label><select style={S.inp} value={formNovoFin.modalidade} onChange={function(e) { setFormNovoFin(function(p) { return { ...p, modalidade: e.target.value } }) }}><option>Parcelado</option><option>A Vista</option></select></div>
                <div><label style={S.lbl}>Forma Pagamento</label><select style={S.inp} value={formNovoFin.forma_pagamento} onChange={function(e) { setFormNovoFin(function(p) { return { ...p, forma_pagamento: e.target.value } }) }}><option>Asaas</option><option>PIX</option><option>Cartao</option><option>Boleto</option></select></div>
                <div><label style={S.lbl}>Valor Total (R$)</label><input style={S.inp} type="number" value={formNovoFin.valor_total} onChange={function(e) { setFormNovoFin(function(p) { return { ...p, valor_total: e.target.value } }) }} autoFocus /></div>
                <div><label style={S.lbl}>Desconto (R$)</label><input style={S.inp} type="number" value={formNovoFin.desconto} onChange={function(e) { setFormNovoFin(function(p) { return { ...p, desconto: e.target.value } }) }} /></div>
                {formNovoFin.modalidade === 'Parcelado' && <div><label style={S.lbl}>Num. Parcelas</label><select style={S.inp} value={formNovoFin.num_parcelas} onChange={function(e) { setFormNovoFin(function(p) { return { ...p, num_parcelas: e.target.value } }) }}>{[2,3,4,5,6,8,10,12].map(function(n){return<option key={n}>{n}</option>})}</select></div>}
              </div>
              {formNovoFin.valor_total && (
                <div style={{ background: C.bgHover, border: '1px solid ' + C.border, borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: C.text3, fontSize: 14 }}>Valor liquido</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: C.gold }}>{fmt(Number(formNovoFin.valor_total) - Number(formNovoFin.desconto || 0))}</div>
                    {formNovoFin.modalidade === 'Parcelado' && <div style={{ fontSize: 13, color: C.text3 }}>{formNovoFin.num_parcelas}x {fmt((Number(formNovoFin.valor_total) - Number(formNovoFin.desconto || 0)) / Number(formNovoFin.num_parcelas))}</div>}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
              <button style={S.btnGhost} onClick={function() { setModalNovoFin(false) }} disabled={savingEdit}>Cancelar</button>
              <button style={S.btnG} onClick={criarFinanceiro} disabled={savingEdit}>{savingEdit ? 'Salvando...' : 'Criar e Gerar Parcelas'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
