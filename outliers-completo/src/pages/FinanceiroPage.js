import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, diasAteVencer, C, PARC_C, ASAAS_STATUS_PT } from '../lib/ui'
import { syncClienteAsaas, criarCobranca, buscarPixQrCode, gerarLinkWhatsApp } from '../lib/asaas'

function Icon({ d, size }) {
  return (
    <svg width={size||16} height={size||16} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

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

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var { data: clis } = await supabase.from('clientes').select('id,nome,email,telefone,cpf,status,asaas_customer_id').order('nome')
    var { data: fins } = await supabase.from('financeiro').select('*, parcelas(*)')

    var finMap = {}
    if (fins) fins.forEach(function(f) { finMap[f.cliente_id] = f })

    var rec = 0, pend = 0, atra = 0
    if (fins) fins.forEach(function(f) {
      (f.parcelas||[]).forEach(function(p) {
        if (p.status === 'Pago') rec += Number(p.valor)
        else if (p.status === 'Atrasado') atra += Number(p.valor)
        else pend += Number(p.valor)
      })
    })

    setStats({ recebido: rec, pendente: pend, atrasado: atra, totalClientes: clis ? clis.length : 0 })

    var listagem = (clis || []).map(function(c) {
      var fin = finMap[c.id] || null
      var parcelas = fin ? (fin.parcelas || []) : []
      var totalPago = parcelas.filter(function(p){ return p.status === 'Pago' }).reduce(function(s,p){ return s+Number(p.valor) },0)
      var totalLiq = fin ? (Number(fin.valor_total) - Number(fin.desconto)) : 0
      var temAtrasado = parcelas.some(function(p){ return p.status === 'Atrasado' })
      var temPendente = parcelas.some(function(p){ return p.status === 'Pendente' })
      return { ...c, fin: fin, totalPago: totalPago, totalLiq: totalLiq, temAtrasado: temAtrasado, temPendente: temPendente }
    })

    setClientes(listagem)
    setLoading(false)
  }

  async function selecionarCliente(c) {
    setSelected(c)
    setLoadingDet(true)
    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', c.id).maybeSingle()
    setFinanceiro(fin || null)
    setLoadingDet(false)
  }

  async function updateParcela(id, status) {
    await supabase.from('parcelas').update({ status: status }).eq('id', id)
    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
    setFinanceiro(fin || null)
    await carregar()
  }

  async function emitirCobranca() {
    if (!showCobranca || !selected) return
    setCobrancaLoading(true)
    setCobrancaErr('')
    try {
      var asaasId = await syncClienteAsaas(selected)
      if (!selected.asaas_customer_id) await supabase.from('clientes').update({ asaas_customer_id: asaasId }).eq('id', selected.id)
      var cob = await criarCobranca({ asaasCustomerId: asaasId, valor: showCobranca.valor, vencimento: showCobranca.vencimento || new Date().toISOString().split('T')[0], descricao: 'Outliers - Parcela ' + showCobranca.numero, billingType: cobrancaBilling, parcelaId: showCobranca.id })
      var pixData = null
      if ((cobrancaBilling === 'PIX' || cobrancaBilling === 'UNDEFINED') && cob.id) {
        try { pixData = await buscarPixQrCode(cob.id) } catch(e) {}
      }
      await supabase.from('parcelas').update({ asaas_payment_id: cob.id, asaas_status: cob.status, asaas_invoice_url: cob.invoiceUrl, asaas_boleto_url: cob.bankSlipUrl, asaas_pix_copia_cola: pixData ? pixData.payload : null }).eq('id', showCobranca.id)
      setCobrancaResult({ ...cob, pixData: pixData })
      var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
      setFinanceiro(fin || null)
    } catch(e) { setCobrancaErr(e.message || 'Erro ao emitir cobranca') }
    setCobrancaLoading(false)
  }

  var filtrados = clientes.filter(function(c) {
    var matchSearch = c.nome.toLowerCase().includes(search.toLowerCase()) || (c.telefone||'').includes(search)
    var matchStatus = filtroStatus === 'Todos' || c.status === filtroStatus
    var matchParcela = filtroParcela === 'Todos'
      || (filtroParcela === 'Atrasado' && c.temAtrasado)
      || (filtroParcela === 'Pendente' && c.temPendente)
      || (filtroParcela === 'Quitado' && c.totalLiq > 0 && c.totalPago >= c.totalLiq)
    return matchSearch && matchStatus && matchParcela
  })

  var S = {
    inp: { background:'#1c1810',border:'1px solid #2a2415',color:'#f0ead8',padding:'8px 12px',fontSize:13,borderRadius:8,outline:'none',fontFamily:'Inter,sans-serif',width:'100%',transition:'border-color .15s' },
    card: { background:'#141209',border:'1px solid #2a2415',borderRadius:10 },
    btnG: { background:'linear-gradient(135deg,#c9a96e,#a07840)',color:'#0a0900',border:'none',padding:'8px 16px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap' },
    btnGhost: { background:'none',border:'1px solid #2a2415',color:'#b8a882',padding:'7px 14px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:12,cursor:'pointer' },
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20 },
    modal: { background:'#141209',border:'1px solid #3d3420',borderRadius:14,padding:28,width:520,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto' },
    lbl: { display:'block',fontSize:11,fontWeight:600,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6 },
  }

  return (
    <div style={{ display:'flex',height:'100%',fontFamily:'Inter,sans-serif',background:'#0a0900' }}>

      {/* Lista */}
      <div style={{ width:selected?360:'100%',borderRight:selected?'1px solid #2a2415':'none',display:'flex',flexDirection:'column' }}>

        {/* Stats topo */}
        <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:'1px solid #2a2415' }}>
          {[
            { l:'Recebido',  v:fmt(stats.recebido),  color:'#4ade80' },
            { l:'Pendente',  v:fmt(stats.pendente),  color:'#fbbf24' },
            { l:'Atrasado',  v:fmt(stats.atrasado),  color:'#f87171' },
            { l:'Clientes',  v:stats.totalClientes,  color:'#c9a96e' },
          ].map(function(s,i) {
            return (
              <div key={i} style={{ padding:'14px 16px',borderRight:i<3?'1px solid #2a2415':'none',textAlign:'center',background:'#0d0b06' }}>
                <div style={{ fontSize:18,fontWeight:700,color:s.color }}>{s.v}</div>
                <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginTop:2 }}>{s.l}</div>
              </div>
            )
          })}
        </div>

        {/* Filtros */}
        <div style={{ padding:'12px 16px',borderBottom:'1px solid #2a2415',display:'flex',gap:8,flexWrap:'wrap',background:'#0d0b06' }}>
          <input style={{ ...S.inp,flex:1,minWidth:120 }} placeholder="Buscar cliente..." value={search} onChange={function(e){setSearch(e.target.value)}} />
          <select style={{ ...S.inp,width:120 }} value={filtroStatus} onChange={function(e){setFiltroStatus(e.target.value)}}>
            {['Todos','Ativo','Inadimplente','Concluido','Inativo'].map(function(s){ return <option key={s}>{s}</option> })}
          </select>
          <select style={{ ...S.inp,width:120 }} value={filtroParcela} onChange={function(e){setFiltroParcela(e.target.value)}}>
            {['Todos','Atrasado','Pendente','Quitado'].map(function(s){ return <option key={s}>{s}</option> })}
          </select>
        </div>

        {/* Lista de clientes */}
        <div style={{ overflowY:'auto',flex:1 }}>
          {loading && <div style={{ padding:30,textAlign:'center',color:'#7a6a4a',fontSize:13 }}>Carregando...</div>}
          {!loading && filtrados.length === 0 && <div style={{ padding:30,textAlign:'center',color:'#7a6a4a',fontSize:13,fontStyle:'italic' }}>Nenhum cliente encontrado.</div>}
          {filtrados.map(function(c) {
            var pct = c.totalLiq > 0 ? Math.round(c.totalPago / c.totalLiq * 100) : 0
            var active = selected && selected.id === c.id
            return (
              <div key={c.id} onClick={function(){ selecionarCliente(c) }}
                style={{ padding:'14px 18px',borderBottom:'1px solid #2a2415',background:active?'#1c1810':'transparent',cursor:'pointer',transition:'background .1s' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:14,fontWeight:600,color:'#f0ead8',marginBottom:2 }}>{c.nome}</div>
                    <div style={{ fontSize:11,color:'#7a6a4a',fontFamily:'monospace' }}>{c.telefone || c.email || '--'}</div>
                  </div>
                  <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4 }}>
                    {c.temAtrasado && <span style={{ fontSize:10,fontWeight:600,color:'#f87171',background:'#7f1d1d22',padding:'2px 7px',borderRadius:20 }}>Atrasado</span>}
                    {!c.temAtrasado && c.temPendente && <span style={{ fontSize:10,fontWeight:600,color:'#fbbf24',background:'#78350f22',padding:'2px 7px',borderRadius:20 }}>Pendente</span>}
                    {!c.temAtrasado && !c.temPendente && c.totalLiq > 0 && <span style={{ fontSize:10,fontWeight:600,color:'#4ade80',background:'#14532d22',padding:'2px 7px',borderRadius:20 }}>Quitado</span>}
                  </div>
                </div>
                {c.totalLiq > 0 && (
                  <div>
                    <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                      <span style={{ fontSize:11,color:'#4ade80' }}>{fmt(c.totalPago)}</span>
                      <span style={{ fontSize:11,color:'#7a6a4a' }}>{fmt(c.totalLiq)} ({pct}%)</span>
                    </div>
                    <div style={{ height:4,background:'#2a2415',borderRadius:2 }}>
                      <div style={{ width:pct+'%',height:'100%',background:pct===100?'#4ade80':'linear-gradient(90deg,#c9a96e,#a07840)',borderRadius:2,transition:'width .4s' }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Detalhe financeiro */}
      {selected && (
        <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column' }}>
          {/* Header */}
          <div style={{ padding:'18px 24px',borderBottom:'1px solid #2a2415',background:'#0d0b06',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
            <div>
              <div style={{ fontSize:20,fontWeight:700,color:'#f0ead8',letterSpacing:'-0.01em' }}>{selected.nome}</div>
              <div style={{ fontSize:12,color:'#7a6a4a',marginTop:3 }}>{selected.email} {selected.email&&selected.telefone?'·':''} {selected.telefone}</div>
            </div>
            <button style={S.btnGhost} onClick={function(){setSelected(null);setFinanceiro(null)}}>✕</button>
          </div>

          <div style={{ padding:24,flex:1 }}>
            {loadingDet && <div style={{ color:'#7a6a4a',fontSize:13 }}>Carregando...</div>}
            {!loadingDet && !financeiro && <div style={{ color:'#7a6a4a',fontSize:13,fontStyle:'italic' }}>Sem dados financeiros cadastrados.</div>}

            {!loadingDet && financeiro && (
              <div style={{ display:'flex',flexDirection:'column',gap:16 }}>
                {/* Resumo cards */}
                <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12 }}>
                  {[
                    { l:'Valor Total',  v:fmt(financeiro.valor_total) },
                    { l:'Desconto',     v:fmt(financeiro.desconto), red:true },
                    { l:'Valor Liquido',v:fmt(financeiro.valor_total-financeiro.desconto), gold:true },
                    { l:'Modalidade',   v:financeiro.modalidade },
                  ].map(function(f,i) {
                    return (
                      <div key={i} style={{ ...S.card,padding:'14px 16px' }}>
                        <div style={S.lbl}>{f.l}</div>
                        <div style={{ fontSize:17,fontWeight:700,color:f.gold?'#c9a96e':f.red?'#f87171':'#f0ead8' }}>{f.v}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Barra de progresso */}
                {(() => {
                  var pagas = (financeiro.parcelas||[]).filter(function(p){return p.status==='Pago'}).reduce(function(s,p){return s+Number(p.valor)},0)
                  var liq = financeiro.valor_total - financeiro.desconto
                  var pct = liq > 0 ? Math.round(pagas/liq*100) : 0
                  return (
                    <div style={{ ...S.card,padding:'14px 18px' }}>
                      <div style={{ display:'flex',justifyContent:'space-between',marginBottom:8 }}>
                        <span style={{ fontSize:12,color:'#7a6a4a' }}>Progresso</span>
                        <span style={{ fontSize:13,fontWeight:700,color:pct===100?'#4ade80':'#c9a96e' }}>{pct}%</span>
                      </div>
                      <div style={{ height:8,background:'#2a2415',borderRadius:4 }}>
                        <div style={{ width:pct+'%',height:'100%',background:pct===100?'#4ade80':'linear-gradient(90deg,#c9a96e,#a07840)',borderRadius:4,transition:'width .5s' }} />
                      </div>
                      <div style={{ display:'flex',justifyContent:'space-between',marginTop:8 }}>
                        <span style={{ fontSize:11,color:'#4ade80' }}>Recebido: {fmt(pagas)}</span>
                        <span style={{ fontSize:11,color:'#fbbf24' }}>Pendente: {fmt(liq-pagas)}</span>
                      </div>
                    </div>
                  )
                })()}

                {/* Parcelas */}
                <div style={S.card}>
                  <div style={{ padding:'12px 18px',borderBottom:'1px solid #2a2415',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                    <span style={{ fontSize:13,fontWeight:600,color:'#f0ead8' }}>Parcelas</span>
                    <span style={{ fontSize:11,color:'#7a6a4a' }}>{(financeiro.parcelas||[]).filter(function(p){return p.status==='Pago'}).length}/{(financeiro.parcelas||[]).length} pagas</span>
                  </div>

                  {(financeiro.parcelas||[]).map(function(p,i,arr) {
                    var pc = PARC_C[p.status] || PARC_C['Pendente']
                    var dias = diasAteVencer(p.vencimento)
                    var alertCor = p.status !== 'Pago' && dias !== null && dias <= 3 ? (dias < 0 ? '#f87171' : '#fbbf24') : null
                    return (
                      <div key={p.id} style={{ padding:'13px 18px',borderBottom:i<arr.length-1?'1px solid #2a2415':'none',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
                        <span style={{ fontSize:11,color:'#7a6a4a',width:22,fontFamily:'monospace' }}>{String(p.numero).padStart(2,'0')}</span>
                        <div style={{ flex:1 }}>
                          <span style={{ fontSize:16,fontWeight:600,color:'#f0ead8' }}>{fmt(p.valor)}</span>
                          {p.vencimento && <span style={{ fontSize:11,color:alertCor||'#7a6a4a',marginLeft:10,fontFamily:'monospace' }}>
                            {fmtDate(p.vencimento)}
                            {alertCor && dias < 0 ? ' ('+Math.abs(dias)+'d atraso)' : alertCor ? ' ('+dias+'d)' : ''}
                          </span>}
                          {p.pago_em && <span style={{ fontSize:11,color:'#4ade80',marginLeft:10 }}>Pago {new Date(p.pago_em).toLocaleDateString('pt-BR')}</span>}
                        </div>
                        {p.asaas_status && <span style={{ fontSize:10,color:'#7a6a4a',background:'#1c1810',padding:'2px 6px',borderRadius:4,fontFamily:'monospace' }}>{ASAAS_STATUS_PT[p.asaas_status]||p.asaas_status}</span>}
                        <select value={p.status} onChange={function(e){updateParcela(p.id,e.target.value)}}
                          style={{ background:pc.bg,border:'1px solid '+pc.border,color:pc.text,padding:'4px 8px',fontSize:11,fontFamily:'monospace',cursor:'pointer',outline:'none',borderRadius:6 }}>
                          <option>Pago</option><option>Pendente</option><option>Atrasado</option>
                        </select>
                        <div style={{ display:'flex',gap:5,flexWrap:'wrap' }}>
                          {p.asaas_invoice_url && <a href={p.asaas_invoice_url} target="_blank" rel="noreferrer" style={{ fontSize:11,color:'#c9a96e',textDecoration:'none',background:'#1c1810',padding:'4px 8px',borderRadius:6,border:'1px solid #2a2415' }}>Fatura</a>}
                          {p.asaas_boleto_url && <a href={p.asaas_boleto_url} target="_blank" rel="noreferrer" style={{ fontSize:11,color:'#c9a96e',textDecoration:'none',background:'#1c1810',padding:'4px 8px',borderRadius:6,border:'1px solid #2a2415' }}>Boleto</a>}
                          {p.asaas_pix_copia_cola && <button onClick={function(){navigator.clipboard.writeText(p.asaas_pix_copia_cola)}} style={{ fontSize:11,color:'#c9a96e',background:'#1c1810',border:'1px solid #2a2415',padding:'4px 8px',borderRadius:6,cursor:'pointer',fontFamily:'Inter,sans-serif' }}>Copiar PIX</button>}
                          {selected.telefone && p.asaas_invoice_url && (
                            <a href={gerarLinkWhatsApp(selected.telefone,selected.nome,fmt(p.valor),fmtDate(p.vencimento),p.asaas_invoice_url)} target="_blank" rel="noreferrer"
                              style={{ fontSize:11,color:'#4ade80',textDecoration:'none',background:'#14532d22',padding:'4px 8px',borderRadius:6,border:'1px solid #14532d',display:'flex',alignItems:'center',gap:4 }}>
                              WhatsApp
                            </a>
                          )}
                          {p.status !== 'Pago' && (
                            <button onClick={function(){setShowCobranca(p);setCobrancaResult(null);setCobrancaErr('')}}
                              style={{ ...S.btnG,padding:'4px 10px',fontSize:11 }}>
                              {p.asaas_payment_id ? 'Reemitir' : '+ Cobrar'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Cobrança */}
      {showCobranca && (
        <div style={S.overlay} onClick={function(){if(!cobrancaLoading){setShowCobranca(null);setCobrancaResult(null)}}}>
          <div style={S.modal} onClick={function(e){e.stopPropagation()}}>
            {!cobrancaResult ? (<>
              <div style={{ fontSize:18,fontWeight:700,color:'#f0ead8',marginBottom:6 }}>Emitir Cobranca</div>
              <div style={{ fontSize:13,color:'#c9a96e',marginBottom:20 }}>{selected&&selected.nome} — Parcela {showCobranca.numero} · {fmt(showCobranca.valor)}</div>
              <div style={{ marginBottom:18 }}>
                <label style={S.lbl}>Forma de Pagamento</label>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:8 }}>
                  {[['UNDEFINED','🔀','Cliente escolhe'],['PIX','⚡','PIX'],['BOLETO','🧾','Boleto'],['CREDIT_CARD','💳','Cartao']].map(function(t) {
                    return (
                      <div key={t[0]} onClick={function(){setCobrancaBilling(t[0])}}
                        style={{ border:'1.5px solid '+(cobrancaBilling===t[0]?'#c9a96e':'#2a2415'),borderRadius:8,padding:'12px 14px',cursor:'pointer',background:cobrancaBilling===t[0]?'#1c1810':'#0d0b06',display:'flex',alignItems:'center',gap:10,transition:'all .15s' }}>
                        <span style={{ fontSize:18 }}>{t[1]}</span>
                        <span style={{ fontSize:13,color:cobrancaBilling===t[0]?'#c9a96e':'#b8a882',fontWeight:cobrancaBilling===t[0]?600:400 }}>{t[2]}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              {cobrancaErr && <div style={{ background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'9px 13px',fontSize:12,borderRadius:8,marginBottom:14 }}>{cobrancaErr}</div>}
              <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
                <button style={S.btnGhost} onClick={function(){setShowCobranca(null)}}>Cancelar</button>
                <button style={S.btnG} onClick={emitirCobranca} disabled={cobrancaLoading}>{cobrancaLoading?'Emitindo...':'Emitir Cobranca'}</button>
              </div>
            </>) : (<>
              <div style={{ textAlign:'center',marginBottom:20 }}>
                <div style={{ fontSize:40,marginBottom:8 }}>✅</div>
                <div style={{ fontSize:18,fontWeight:700,color:'#f0ead8' }}>Cobranca Emitida!</div>
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
                {cobrancaResult.invoiceUrl && (
                  <div style={{ ...S.card,padding:'14px 16px' }}>
                    <label style={S.lbl}>Link da Fatura</label>
                    <div style={{ display:'flex',gap:8,marginTop:6,alignItems:'center' }}>
                      <div style={{ flex:1,fontSize:11,color:'#7a6a4a',wordBreak:'break-all',fontFamily:'monospace' }}>{cobrancaResult.invoiceUrl}</div>
                      <button style={{ ...S.btnGhost,padding:'5px 10px',fontSize:11 }} onClick={function(){navigator.clipboard.writeText(cobrancaResult.invoiceUrl)}}>Copiar</button>
                    </div>
                    {selected && selected.telefone && (
                      <a href={gerarLinkWhatsApp(selected.telefone,selected.nome,fmt(showCobranca.valor),fmtDate(showCobranca.vencimento),cobrancaResult.invoiceUrl)} target="_blank" rel="noreferrer"
                        style={{ display:'inline-flex',alignItems:'center',gap:6,marginTop:10,fontSize:12,color:'#4ade80',textDecoration:'none',background:'#14532d22',padding:'7px 14px',borderRadius:6,border:'1px solid #14532d' }}>
                        Enviar por WhatsApp
                      </a>
                    )}
                  </div>
                )}
                {cobrancaResult.pixData && cobrancaResult.pixData.encodedImage && (
                  <div style={{ ...S.card,padding:'14px 16px' }}>
                    <label style={S.lbl}>PIX QR Code</label>
                    <div style={{ display:'flex',gap:14,alignItems:'center',marginTop:8 }}>
                      <img src={"data:image/png;base64,"+cobrancaResult.pixData.encodedImage} alt="QR PIX" style={{ width:90,height:90,background:'#fff',borderRadius:4 }} />
                      <button style={{ ...S.btnGhost,fontSize:11,padding:'6px 12px' }} onClick={function(){navigator.clipboard.writeText(cobrancaResult.pixData.payload)}}>Copiar codigo PIX</button>
                    </div>
                  </div>
                )}
                <div style={{ background:'#1c1810',border:'1px solid #2a2415',padding:'9px 13px',fontSize:12,color:'#7a6a4a',borderRadius:8 }}>
                  A parcela sera atualizada automaticamente quando o cliente pagar.
                </div>
              </div>
              <div style={{ display:'flex',justifyContent:'flex-end',marginTop:18 }}>
                <button style={S.btnG} onClick={function(){setShowCobranca(null);setCobrancaResult(null)}}>Fechar</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}
