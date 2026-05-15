import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, formatTel, unformatTel, formatCPF, unformatCPF, C, STATUS_C } from '../lib/ui'
import { importarPlanilhaOutliers } from '../lib/importarOutliers'

function Badge({ label, colors }) {
  return <span style={{ background:colors.bg+'33',color:colors.text,border:'1px solid '+colors.bg,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,whiteSpace:'nowrap' }}>{label}</span>
}

function emptyClient() {
  return { nome:'',email:'',telefone:'',cpf:'',origem:'Paradigma',status:'Ativo',programa:'Outliers',edicao:'',observacoes:'',data_entrada:new Date().toISOString().split('T')[0] }
}

export default function CRMPage() {
  var auth = useAuth()
  var [clients, setClients] = useState([])
  var [selected, setSelected] = useState(null)
  var [tab, setTab] = useState('dados')
  var [search, setSearch] = useState('')
  var [fStatus, setFStatus] = useState('Todos')
  var [fOrigem, setFOrigem] = useState('Todos')
  var [loading, setLoading] = useState(true)
  var [loadingDet, setLoadingDet] = useState(false)
  var [showNew, setShowNew] = useState(false)
  var [newClient, setNewClient] = useState(emptyClient())
  var [saving, setSaving] = useState(false)
  var [presencas, setPresencas] = useState([])
  var [editing, setEditing] = useState(false)
  var [editForm, setEditForm] = useState(null)
  var [savingEdit, setSavingEdit] = useState(false)

  var fetchClients = useCallback(async function() {
    setLoading(true)
    var { data } = await supabase.from('clientes').select('id,nome,email,telefone,cpf,origem,status,programa,edicao,data_entrada,observacoes').order('nome')
    setClients(data || [])
    setLoading(false)
  }, [])

  useEffect(function() { fetchClients() }, [fetchClients])

  async function fetchDetail(id) {
    setLoadingDet(true)
    var [r1, r2, r3] = await Promise.all([
      supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', id).maybeSingle(),
      supabase.from('historico').select('*').eq('cliente_id', id).order('data', { ascending: false }),
      // Busca presenças: participante vinculado ao cliente
      supabase.from('participantes').select('*, eventos(nome, data_inicio, data_fim, local, tipo)').eq('cliente_id', id).order('created_at', { ascending: false })
    ])
    setSelected(function(prev) { return { ...prev, financeiro: r1.data||null, historico: r2.data||[] } })
    setPresencas(r3.data || [])
    setLoadingDet(false)
  }

  var filtered = clients.filter(function(c) {
    var s = search.toLowerCase()
    return (c.nome.toLowerCase().includes(s)||(c.email||'').toLowerCase().includes(s)||(c.telefone||'').includes(s))
      && (fStatus==='Todos'||c.status===fStatus)
      && (fOrigem==='Todos'||c.origem===fOrigem)
  })

  var stats = { total:clients.length, ativos:clients.filter(function(c){return c.status==='Ativo'}).length, inad:clients.filter(function(c){return c.status==='Inadimplente'}).length }

  async function saveNew() {
    if (!newClient.nome.trim()) return
    setSaving(true)
    var payload = { ...newClient, telefone: unformatTel(newClient.telefone) || null, cpf: unformatCPF(newClient.cpf) || null, criado_por: auth.profile?auth.profile.id:null }
    await supabase.from('clientes').insert(payload)
    await fetchClients()
    setShowNew(false); setNewClient(emptyClient())
    setSaving(false)
  }

  var S = {
    inp: { background:'#1c1810',border:'1px solid #2a2415',color:'#f0ead8',padding:'8px 12px',fontSize:13,borderRadius:8,outline:'none',fontFamily:'Inter,sans-serif',width:'100%' },
    card: { background:'#141209',border:'1px solid #2a2415',borderRadius:10 },
    btnG: { background:'linear-gradient(135deg,#c9a96e,#a07840)',color:'#0a0900',border:'none',padding:'9px 18px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap' },
    btnGhost: { background:'none',border:'1px solid #2a2415',color:'#b8a882',padding:'8px 14px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:13,cursor:'pointer' },
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20 },
    modal: { background:'#141209',border:'1px solid #3d3420',borderRadius:14,padding:28,width:540,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto' },
    lbl: { display:'block',fontSize:11,fontWeight:600,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6 },
  }

  return (
    <div style={{ display:'flex',height:'100%',fontFamily:'Inter,sans-serif',background:'#0a0900' }}>

      {/* Lista */}
      <div style={{ width:selected?360:'100%',borderRight:selected?'1px solid #2a2415':'none',display:'flex',flexDirection:'column' }}>
        <div style={{ display:'flex',borderBottom:'1px solid #2a2415' }}>
          {[{l:'Total',v:stats.total},{l:'Ativos',v:stats.ativos},{l:'Inad.',v:stats.inad,alert:stats.inad>0}].map(function(s,i) {
            return (
              <div key={i} style={{ flex:1,padding:'10px 14px',borderRight:i<2?'1px solid #2a2415':'none',textAlign:'center',background:'#0d0b06' }}>
                <div style={{ fontSize:20,fontWeight:700,color:s.alert?'#f87171':'#f0ead8' }}>{s.v}</div>
                <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginTop:2 }}>{s.l}</div>
              </div>
            )
          })}
          <div style={{ display:'flex',alignItems:'center',gap:6,padding:'0 12px',background:'#0d0b06' }}>
            {auth.canEditClientes && (
              <button style={{ background:'#1c1810',border:'1px solid #2a2415',color:'#a08658',padding:'7px 11px',borderRadius:6,fontSize:11,cursor:'pointer',fontFamily:'Inter,sans-serif' }}
                      title="Recalcula o status (Ativo/Inadimplente) de todos os clientes baseado nas parcelas atuais"
                      onClick={async function() {
                        if (!window.confirm('Recalcular status de todos os clientes?\n\nClientes sem parcela atrasada voltam para "Ativo".')) return
                        var r = await supabase.rpc('recalcular_status_todos_clientes')
                        if (r.error) { alert('Erro: ' + r.error.message); return }
                        var d = r.data || {}
                        alert('Recalculado!\n\n• Processados: ' + (d.clientes_processados||0)
                          + '\n• Voltaram para Ativo: ' + (d.inadimplente_para_ativo||0)
                          + '\n• Marcados Inadimplente: ' + (d.ativo_para_inadimplente||0))
                        if (typeof window !== 'undefined') window.location.reload()
                      }}>🔄 Recalcular</button>
            )}
            {auth.canEditClientes && (
              <label style={{ background:'#1c1810',border:'1px solid #2a2415',color:'#a08658',padding:'7px 11px',borderRadius:6,fontSize:11,cursor:'pointer',fontFamily:'Inter,sans-serif',display:'flex',alignItems:'center',gap:4 }}
                     title="Importar planilha CSV de clientes Outliers (com vendas e parcelas)">
                📂 Importar
                <input type="file" accept=".csv,text/csv" style={{ display:'none' }} onChange={async function(e) {
                  var file = e.target.files[0]; e.target.value = ''
                  if (!file) return
                  if (!window.confirm('Importar planilha "' + file.name + '"?\n\nFormato esperado: CSV (separador ; ou ,) com colunas:\nnome; email; telefone; cpf; curso; valor_total; desconto; modalidade; num_parcelas; data_primeira_parcela; parcelas_pagas; datas_pagamento; programa; edicao; origem; observacoes\n\nBaixe o template em /template-outliers.csv se precisar.')) return
                  var text = await file.text()
                  var res = await importarPlanilhaOutliers(text, { userId: auth.profile && auth.profile.id })
                  if (!res.ok) { alert('Erro: ' + res.error); return }
                  var msg = 'Importação concluída!\n\n✓ ' + res.criados + ' cliente(s) criado(s) com vendas e parcelas.\n'
                  if (res.erros && res.erros.length) {
                    msg += '\n⚠️ ' + res.erros.length + ' linha(s) com erro:\n'
                    res.erros.slice(0,10).forEach(function(er){ msg += '  • Linha ' + er.linha + ': ' + er.motivo + '\n' })
                    if (res.erros.length > 10) msg += '  • ...e mais ' + (res.erros.length - 10) + '\n'
                  }
                  alert(msg)
                  fetchClients()
                }} />
              </label>
            )}
            {auth.canEditClientes && (
              <a href="/template-outliers.csv" download
                 style={{ background:'transparent', color:'#7a6a4a', padding:'7px 6px', fontSize:10, textDecoration:'underline', fontFamily:'Inter,sans-serif' }}
                 title="Baixar template CSV">template</a>
            )}
            {auth.canEditClientes && <button style={S.btnG} onClick={function(){setShowNew(true)}}>+ Novo</button>}
          </div>
        </div>

        <div style={{ padding:'10px 14px',borderBottom:'1px solid #2a2415',display:'flex',gap:8,flexWrap:'wrap',background:'#0d0b06' }}>
          <input style={{ ...S.inp,flex:1,minWidth:100 }} placeholder="Buscar..." value={search} onChange={function(e){setSearch(e.target.value)}} />
          <select style={{ ...S.inp,width:110 }} value={fStatus} onChange={function(e){setFStatus(e.target.value)}}>
            {['Todos','Ativo','Inadimplente','Concluido','Inativo'].map(function(s){return <option key={s}>{s}</option>})}
          </select>
          <select style={{ ...S.inp,width:120 }} value={fOrigem} onChange={function(e){setFOrigem(e.target.value)}}>
            {['Todos','Paradigma','Indicacao','Renovacao','Outro'].map(function(s){return <option key={s}>{s}</option>})}
          </select>
        </div>

        <div style={{ overflowY:'auto',flex:1 }}>
          {loading && <div style={{ padding:30,textAlign:'center',color:'#7a6a4a',fontSize:13 }}>Carregando...</div>}
          {!loading&&filtered.length===0&&<div style={{ padding:30,textAlign:'center',color:'#7a6a4a',fontSize:13,fontStyle:'italic' }}>Nenhum cliente.</div>}
          {filtered.map(function(c) {
            var sc = STATUS_C[c.status] || STATUS_C['Inativo']
            var active = selected && selected.id === c.id
            return (
              <div key={c.id} onClick={function(){ setTab('dados'); setSelected(c); fetchDetail(c.id) }}
                style={{ padding:'13px 16px',borderBottom:'1px solid #2a2415',background:active?'#1c1810':'transparent',cursor:'pointer',transition:'background .1s' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5 }}>
                  <div style={{ fontSize:14,fontWeight:600,color:'#f0ead8' }}>{c.nome}</div>
                  <Badge label={c.status} colors={sc} />
                </div>
                <div style={{ fontSize:11,color:'#7a6a4a' }}>{c.email || formatTel(c.telefone) || '--'}</div>
                <div style={{ fontSize:11,color:'#7a6a4a',marginTop:2 }}>{c.origem}{c.edicao?' · '+c.edicao:''}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detalhe */}
      {selected && (
        <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column' }}>
          <div style={{ padding:'18px 24px',borderBottom:'1px solid #2a2415',background:'#0d0b06',display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:22,fontWeight:700,color:'#f0ead8',letterSpacing:'-0.01em',marginBottom:4 }}>{selected.nome}</div>
              <div style={{ fontSize:12,color:'#7a6a4a' }}>{selected.email} {selected.email&&selected.telefone?'·':''} {formatTel(selected.telefone)}</div>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              {auth.canEditClientes && (
                <select style={{ ...S.inp,width:140 }} value={selected.status}
                  onChange={async function(e) {
                    var ns = e.target.value
                    await supabase.from('clientes').update({status:ns}).eq('id',selected.id)
                    setClients(function(prev){return prev.map(function(c){return c.id===selected.id?{...c,status:ns}:c})})
                    setSelected(function(prev){return {...prev,status:ns}})
                  }}>
                  {['Ativo','Inadimplente','Concluido','Inativo'].map(function(s){return <option key={s}>{s}</option>})}
                </select>
              )}
              {auth.canDeleteClientes && (
                <button style={{ ...S.btnGhost, color:'#fca5a5', borderColor:'#7f1d1d' }}
                        title="Excluir cliente"
                        onClick={async function() {
                          if (!window.confirm('EXCLUIR o cliente "' + selected.nome + '"?\n\nIsso apaga TUDO relacionado: vendas, parcelas, comissões, contratos, histórico.\n\nNão pode ser desfeito.')) return
                          var conf = window.prompt('Tem certeza absoluta? Digite EXCLUIR para confirmar.')
                          if (conf !== 'EXCLUIR') { alert('Cancelado.'); return }
                          var r = await supabase.rpc('excluir_cliente', { p_cli_id: selected.id })
                          if (r.error) { alert('Erro: ' + r.error.message); return }
                          if (!r.data || !r.data.ok) { alert('Erro: ' + ((r.data && r.data.error) || 'desconhecido')); return }
                          setSelected(null)
                          fetchClients()
                        }}>🗑️ Excluir</button>
              )}
              <button style={S.btnGhost} onClick={function(){setSelected(null)}}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex',borderBottom:'1px solid #2a2415',background:'#0d0b06',padding:'0 24px' }}>
            {['dados','presencas', auth.canSeeFinanceiro?'financeiro':null,'historico'].filter(Boolean).map(function(t) {
              return (
                <button key={t} onClick={function(){setTab(t)}}
                  style={{ background:'none',border:'none',borderBottom:tab===t?'2px solid #c9a96e':'2px solid transparent',padding:'12px 16px',color:tab===t?'#c9a96e':'#7a6a4a',cursor:'pointer',fontSize:13,fontWeight:tab===t?600:400,fontFamily:'Inter,sans-serif',marginBottom:-1 }}>
                  {t==='dados'?'Dados':t==='presencas'?'Presenças 📍':t==='financeiro'?'Financeiro':'Historico'}
                </button>
              )
            })}
          </div>

          <div style={{ padding:24,flex:1,overflowY:'auto' }}>

            {/* TAB DADOS */}
            {tab==='dados' && (
              <div>
                {auth.canEditClientes && !editing && (
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
                    <button style={S.btnGhost} onClick={function(){
                      setEditForm({
                        nome: selected.nome || '',
                        email: selected.email || '',
                        telefone: selected.telefone || '',
                        cpf: selected.cpf || '',
                        programa: selected.programa || '',
                        edicao: selected.edicao || '',
                        origem: selected.origem || '',
                        data_entrada: selected.data_entrada ? String(selected.data_entrada).slice(0,10) : '',
                        observacoes: selected.observacoes || '',
                      })
                      setEditing(true)
                    }}>✎ Editar</button>
                  </div>
                )}

                {!editing && (
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
                    {[
                      {l:'Nome',     v:selected.nome},
                      {l:'E-mail',   v:selected.email},
                      {l:'Telefone', v:formatTel(selected.telefone)},
                      {l:'CPF',      v:formatCPF(selected.cpf)},
                      {l:'Programa', v:selected.programa},
                      {l:'Edição',   v:selected.edicao},
                      {l:'Origem',   v:selected.origem},
                      {l:'Entrada',  v:selected.data_entrada ? fmtDate(selected.data_entrada) : null},
                    ].map(function(f,i) {
                      return (
                        <div key={i} style={{ ...S.card,padding:'12px 16px' }}>
                          <div style={S.lbl}>{f.l}</div>
                          <div style={{ fontSize:14,color:'#f0ead8',fontWeight:500 }}>{f.v || '--'}</div>
                        </div>
                      )
                    })}
                    <div style={{ ...S.card,padding:'12px 16px',gridColumn:'1/-1' }}>
                      <div style={S.lbl}>Observações</div>
                      <div style={{ fontSize:13,color:'#b8a882',fontStyle:'italic',whiteSpace:'pre-wrap' }}>{selected.observacoes || '--'}</div>
                    </div>
                  </div>
                )}

                {editing && editForm && (
                  <div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
                      {[
                        {k:'nome',         l:'Nome',     type:'text'},
                        {k:'email',        l:'E-mail',   type:'email'},
                        {k:'telefone',     l:'Telefone', type:'text'},
                        {k:'cpf',          l:'CPF',      type:'text'},
                        {k:'programa',     l:'Programa', type:'text'},
                        {k:'edicao',       l:'Edição',   type:'text'},
                        {k:'origem',       l:'Origem',   type:'text'},
                        {k:'data_entrada', l:'Entrada',  type:'date'},
                      ].map(function(f) {
                        return (
                          <div key={f.k} style={{ ...S.card,padding:'12px 16px' }}>
                            <div style={S.lbl}>{f.l}</div>
                            <input
                              type={f.type}
                              value={editForm[f.k] || ''}
                              onChange={function(e){
                                var v = e.target.value
                                setEditForm(function(prev){ return { ...prev, [f.k]: v } })
                              }}
                              style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:6, color:'#f0ead8', fontSize:14, padding:'8px 10px', width:'100%', outline:'none', fontFamily:'Inter,sans-serif', marginTop:4 }}
                            />
                          </div>
                        )
                      })}
                      <div style={{ ...S.card,padding:'12px 16px',gridColumn:'1/-1' }}>
                        <div style={S.lbl}>Observações</div>
                        <textarea
                          value={editForm.observacoes || ''}
                          rows={3}
                          onChange={function(e){
                            var v = e.target.value
                            setEditForm(function(prev){ return { ...prev, observacoes: v } })
                          }}
                          style={{ background:'#0a0900', border:'1px solid #2a2415', borderRadius:6, color:'#b8a882', fontSize:13, padding:'8px 10px', width:'100%', outline:'none', fontFamily:'Inter,sans-serif', resize:'vertical', marginTop:4 }}
                          placeholder="Anotações sobre o cliente..."
                        />
                      </div>
                    </div>

                    <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:16 }}>
                      <button style={S.btnGhost} disabled={savingEdit}
                              onClick={function(){ setEditing(false); setEditForm(null) }}>Cancelar</button>
                      <button style={S.btnG} disabled={savingEdit}
                              onClick={async function() {
                                setSavingEdit(true)
                                var patch = {
                                  nome:         editForm.nome || null,
                                  email:        editForm.email || null,
                                  telefone:     unformatTel(editForm.telefone) || null,
                                  cpf:          unformatCPF(editForm.cpf) || null,
                                  programa:     editForm.programa || null,
                                  edicao:       editForm.edicao || null,
                                  origem:       editForm.origem || null,
                                  data_entrada: editForm.data_entrada || null,
                                  observacoes:  editForm.observacoes || null,
                                }
                                var r = await supabase.from('clientes').update(patch).eq('id', selected.id)
                                setSavingEdit(false)
                                if (r.error) { alert('Erro: ' + r.error.message); return }
                                setClients(function(prev){ return prev.map(function(c){ return c.id===selected.id ? { ...c, ...patch } : c }) })
                                setSelected(function(prev){ return { ...prev, ...patch } })
                                setEditing(false); setEditForm(null)
                              }}>{savingEdit ? 'Salvando…' : 'Salvar alterações'}</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB PRESENÇAS */}
            {tab==='presencas' && (
              <div>
                <div style={{ marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:700,color:'#f0ead8' }}>Histórico de Presenças</div>
                    <div style={{ fontSize:12,color:'#7a6a4a',marginTop:3 }}>{presencas.length} evento(s) cadastrado(s)</div>
                  </div>
                  <div style={{ display:'flex',gap:12 }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:22,fontWeight:700,color:'#4ade80' }}>{presencas.filter(function(p){return p.checkin_at}).length}</div>
                      <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em' }}>Presente</div>
                    </div>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:22,fontWeight:700,color:'#fbbf24' }}>{presencas.filter(function(p){return !p.checkin_at}).length}</div>
                      <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em' }}>Ausente</div>
                    </div>
                  </div>
                </div>

                {loadingDet && <div style={{ color:'#7a6a4a',fontSize:13 }}>Carregando...</div>}

                {!loadingDet && presencas.length === 0 && (
                  <div style={{ ...S.card,padding:32,textAlign:'center' }}>
                    <div style={{ fontSize:32,marginBottom:10 }}>📍</div>
                    <div style={{ color:'#7a6a4a',fontSize:14 }}>Este aluno ainda não foi inscrito em nenhum evento.</div>
                  </div>
                )}

                {!loadingDet && presencas.length > 0 && (
                  <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                    {presencas.map(function(p) {
                      var presente = !!p.checkin_at
                      var ev = p.eventos
                      return (
                        <div key={p.id} style={{ ...S.card,padding:'16px 20px',display:'flex',alignItems:'center',gap:16 }}>
                          {/* Status icon */}
                          <div style={{ width:44,height:44,borderRadius:9999,background:presente?'#14532d22':'#78350f22',border:'2px solid '+(presente?'#16a34a':'#92400e'),display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:20 }}>
                            {presente?'✅':'⭕'}
                          </div>
                          {/* Info evento */}
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:15,fontWeight:600,color:'#f0ead8',marginBottom:3 }}>{ev?ev.nome:'Evento'}</div>
                            <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
                              {ev && <span style={{ fontSize:11,color:'#7a6a4a',fontFamily:'monospace' }}>📅 {fmtDate(ev.data_inicio)}{ev.data_fim&&ev.data_fim!==ev.data_inicio?' → '+fmtDate(ev.data_fim):''}</span>}
                              {ev && ev.local && <span style={{ fontSize:11,color:'#7a6a4a' }}>📍 {ev.local}</span>}
                              {ev && ev.tipo && <span style={{ fontSize:10,color:'#c9a96e',background:'#c9a96e18',padding:'1px 7px',borderRadius:20 }}>{ev.tipo}</span>}
                            </div>
                          </div>
                          {/* Status presença */}
                          <div style={{ textAlign:'right',flexShrink:0 }}>
                            {presente ? (
                              <div>
                                <div style={{ fontSize:12,fontWeight:700,color:'#4ade80' }}>Presente ✓</div>
                                <div style={{ fontSize:11,color:'#7a6a4a',marginTop:2 }}>
                                  {new Date(p.checkin_at).toLocaleDateString('pt-BR')} às {new Date(p.checkin_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div style={{ fontSize:12,fontWeight:700,color:'#fbbf24' }}>Inscrito</div>
                                <div style={{ fontSize:11,color:'#7a6a4a',marginTop:2 }}>Não fez check-in</div>
                              </div>
                            )}
                            {p.comprou && <div style={{ fontSize:10,color:'#c9a96e',marginTop:4,fontWeight:600 }}>💰 Comprou</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB FINANCEIRO — só para quem tem permissão */}
            {tab==='financeiro' && auth.canSeeFinanceiro && (
              loadingDet ? <div style={{ color:'#7a6a4a',fontSize:13 }}>Carregando...</div> :
              !selected.financeiro ? <div style={{ color:'#7a6a4a',fontSize:13,fontStyle:'italic' }}>Sem dados financeiros.</div> : (
                <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12 }}>
                    {[
                      {l:'Total',v:fmt(selected.financeiro.valor_total)},
                      {l:'Desconto',v:fmt(selected.financeiro.desconto),red:true},
                      {l:'Liquido',v:fmt(selected.financeiro.valor_total-selected.financeiro.desconto),gold:true},
                      {l:'Modalidade',v:selected.financeiro.modalidade},
                    ].map(function(f,i) {
                      return (
                        <div key={i} style={{ ...S.card,padding:'12px 16px' }}>
                          <div style={S.lbl}>{f.l}</div>
                          <div style={{ fontSize:16,fontWeight:700,color:f.gold?'#c9a96e':f.red?'#f87171':'#f0ead8' }}>{f.v}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={S.card}>
                    <div style={{ padding:'11px 16px',borderBottom:'1px solid #2a2415',display:'flex',justifyContent:'space-between' }}>
                      <span style={{ fontSize:12,fontWeight:600,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em' }}>Parcelas</span>
                      <span style={{ fontSize:11,color:'#7a6a4a' }}>{(selected.financeiro.parcelas||[]).filter(function(p){return p.status==='Pago'}).length}/{(selected.financeiro.parcelas||[]).length} pagas</span>
                    </div>
                    {(selected.financeiro.parcelas||[]).map(function(p,i,arr) {
                      var cor = p.status==='Pago'?'#4ade80':p.status==='Atrasado'?'#f87171':'#fbbf24'
                      return (
                        <div key={p.id} style={{ padding:'10px 16px',borderBottom:i<arr.length-1?'1px solid #2a2415':'none',display:'flex',alignItems:'center',gap:10 }}>
                          <span style={{ fontSize:11,color:'#7a6a4a',width:22,fontFamily:'monospace' }}>{String(p.numero).padStart(2,'0')}</span>
                          <span style={{ flex:1,fontSize:15,fontWeight:600,color:'#f0ead8' }}>{fmt(p.valor)}</span>
                          {p.vencimento && <span style={{ fontSize:11,color:'#7a6a4a',fontFamily:'monospace' }}>Venc. {fmtDate(p.vencimento)}</span>}
                          <span style={{ fontSize:11,fontWeight:600,color:cor,background:cor+'22',padding:'2px 8px',borderRadius:20 }}>{p.status}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            )}

            {/* TAB HISTORICO */}
            {tab==='historico' && !loadingDet && (
              <div>
                {(selected.historico||[]).length===0 ? <div style={{ color:'#7a6a4a',fontSize:13,fontStyle:'italic' }}>Nenhum registro.</div>
                :(selected.historico||[]).map(function(h) {
                  return (
                    <div key={h.id} style={{ ...S.card,padding:'13px 18px',display:'flex',gap:14,marginBottom:10 }}>
                      <div style={{ fontSize:11,color:'#c9a96e',fontFamily:'monospace',minWidth:76 }}>{fmtDate(h.data)}</div>
                      <div style={{ fontSize:13,color:'#b8a882' }}>{h.descricao}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {auth.isOperacional && (
              <div style={{ marginTop:16,background:'#78350f22',border:'1px solid #78350f',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#fbbf24' }}>
                ℹ️ Para ver dados financeiros deste cliente, entre em contato com o time Financeiro.
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Novo Cliente */}
      {showNew && (
        <div style={S.overlay} onClick={function(){setShowNew(false)}}>
          <div style={S.modal} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize:18,fontWeight:700,color:'#f0ead8',marginBottom:22 }}>Novo Cliente</div>
            <div style={{ display:'flex',flexDirection:'column',gap:13 }}>
              <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={newClient.nome} onChange={function(e){setNewClient(function(p){return {...p,nome:e.target.value}})}} /></div>
              <div style={{ display:'flex',gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>E-mail</label><input style={S.inp} type="email" value={newClient.email} onChange={function(e){setNewClient(function(p){return {...p,email:e.target.value}})}} /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>Telefone</label><input style={S.inp} value={newClient.telefone} onChange={function(e){setNewClient(function(p){return {...p,telefone:e.target.value}})}} placeholder="(11) 98765-4321" /></div>
              </div>
              <div style={{ display:'flex',gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>CPF</label><input style={S.inp} value={newClient.cpf} onChange={function(e){setNewClient(function(p){return {...p,cpf:e.target.value}})}} placeholder="000.000.000-00" /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>Origem</label>
                  <select style={S.inp} value={newClient.origem} onChange={function(e){setNewClient(function(p){return {...p,origem:e.target.value}})}}>
                    {['Paradigma','Indicação','Renovação','Instagram','TikTok','YouTube','Facebook','Outro'].map(function(o){return <option key={o}>{o}</option>})}
                  </select>
                </div>
              </div>
              <div style={{ display:'flex',gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Edicao</label><input style={S.inp} value={newClient.edicao} onChange={function(e){setNewClient(function(p){return {...p,edicao:e.target.value}})}} /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>Data Entrada</label><input style={S.inp} type="date" value={newClient.data_entrada} onChange={function(e){setNewClient(function(p){return {...p,data_entrada:e.target.value}})}} /></div>
              </div>
              <div><label style={S.lbl}>Observacoes</label><textarea style={{ ...S.inp,height:60,resize:'vertical' }} value={newClient.observacoes} onChange={function(e){setNewClient(function(p){return {...p,observacoes:e.target.value}})}} /></div>
            </div>
            <div style={{ display:'flex',gap:10,justifyContent:'flex-end',marginTop:20 }}>
              <button style={S.btnGhost} onClick={function(){setShowNew(false)}}>Cancelar</button>
              <button style={S.btnG} onClick={saveNew} disabled={saving||!newClient.nome.trim()}>{saving?'Salvando...':'Cadastrar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
