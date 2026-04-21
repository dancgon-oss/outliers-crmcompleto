import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, C, STATUS_C, INPUT_S, BTN_PRIMARY, BTN_GHOST, LABEL_S, CARD_S, OVERLAY_S, MODAL_S } from '../lib/ui'

var ORIGENS = ['Paradigma','Indicacao','Renovacao','Outro']
var STATUSES = ['Ativo','Inadimplente','Concluido','Inativo']
var EMPTY_CLIENT = { nome:'', email:'', telefone:'', cpf:'', origem:'Paradigma', status:'Ativo', programa:'Outliers', edicao:'', evento_origem_id:'', observacoes:'', data_entrada:'' }

function Badge({ status }) {
  var c = STATUS_C[status] || STATUS_C['Inativo']
  return <span style={{ fontSize:12, fontWeight:600, color:c.text, background:c.bg, border:'1px solid '+c.border, padding:'3px 10px', borderRadius:20, whiteSpace:'nowrap' }}>{status}</span>
}

export default function CRMPage() {
  var auth = useAuth()
  var [clientes, setClientes]     = useState([])
  var [eventos, setEventos]       = useState([])
  var [selected, setSelected]     = useState(null)
  var [detTab, setDetTab]         = useState('dados')
  var [loading, setLoading]       = useState(true)
  var [search, setSearch]         = useState('')
  var [filtStatus, setFiltStatus] = useState('Todos')
  var [filtOrigem, setFiltOrigem] = useState('Todos')
  var [modalNew, setModalNew]     = useState(false)
  var [form, setForm]             = useState(EMPTY_CLIENT)
  var [saving, setSaving]         = useState(false)
  var [erro, setErro]             = useState('')
  var [editando, setEditando]     = useState(false)
  var [histDetalhes, setHistDetalhes] = useState([])
  var [novaObs, setNovaObs]       = useState('')
  var [financeiro, setFinanceiro] = useState(null)
  var [presencas, setPresencas]   = useState([])

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var [rc, rev] = await Promise.all([
      supabase.from('clientes').select('id,nome,email,telefone,cpf,origem,status,programa,edicao,data_entrada,evento_origem_id,asaas_customer_id,observacoes,created_at').order('nome'),
      supabase.from('eventos').select('id,nome,data_inicio').order('data_inicio',{ascending:false})
    ])
    setClientes(rc.data||[])
    setEventos(rev.data||[])
    setLoading(false)
  }

  async function selecionarCliente(c) {
    setSelected(c)
    setDetTab('dados')
    setEditando(false)
    setForm({ nome:c.nome, email:c.email||'', telefone:c.telefone||'', cpf:c.cpf||'', origem:c.origem, status:c.status, programa:c.programa||'Outliers', edicao:c.edicao||'', evento_origem_id:c.evento_origem_id||'', observacoes:c.observacoes||'', data_entrada:c.data_entrada||'' })
    var [rh, rf, rp] = await Promise.all([
      supabase.from('historico').select('*').eq('cliente_id',c.id).order('data',{ascending:false}),
      supabase.from('financeiro').select('*,parcelas(*)').eq('cliente_id',c.id).maybeSingle(),
      supabase.from('participantes').select('*,eventos(nome,data_inicio)').eq('cliente_id',c.id)
    ])
    setHistDetalhes(rh.data||[])
    setFinanceiro(rf.data||null)
    setPresencas(rp.data||[])
  }

  async function salvarCliente() {
    if (!form.nome.trim()) { setErro('Nome obrigatorio.'); return }
    setSaving(true); setErro('')
    var payload = { nome:form.nome.trim(), email:form.email||null, telefone:form.telefone||null, cpf:form.cpf||null, origem:form.origem, status:form.status, programa:form.programa||'Outliers', edicao:form.edicao||null, evento_origem_id:form.evento_origem_id||null, observacoes:form.observacoes||null, data_entrada:form.data_entrada||null }
    if (modalNew) {
      var r = await supabase.from('clientes').insert({...payload, criado_por:auth.profile ? auth.profile.id : null})
      if (r.error) { setErro(r.error.message); setSaving(false); return }
      setModalNew(false)
    } else if (editando && selected) {
      var r2 = await supabase.from('clientes').update(payload).eq('id',selected.id)
      if (r2.error) { setErro(r2.error.message); setSaving(false); return }
      setEditando(false)
      var upd = await supabase.from('clientes').select('*').eq('id',selected.id).single()
      if (upd.data) setSelected(upd.data)
    }
    setSaving(false); setErro('')
    carregar()
  }

  async function adicionarHistorico() {
    if (!novaObs.trim()||!selected) return
    await supabase.from('historico').insert({ cliente_id:selected.id, descricao:novaObs.trim(), criado_por:auth.profile ? auth.profile.id : null })
    setNovaObs('')
    var rh = await supabase.from('historico').select('*').eq('cliente_id',selected.id).order('data',{ascending:false})
    setHistDetalhes(rh.data||[])
  }

  var filtrados = clientes.filter(function(c) {
    var ms = !search || c.nome.toLowerCase().includes(search.toLowerCase()) || (c.telefone||'').includes(search) || (c.email||'').toLowerCase().includes(search.toLowerCase())
    var mt = filtStatus==='Todos'||c.status===filtStatus
    var mo = filtOrigem==='Todos'||c.origem===filtOrigem
    return ms&&mt&&mo
  })

  var stats = { total:clientes.length, ativos:clientes.filter(function(c){return c.status==='Ativo'}).length, inad:clientes.filter(function(c){return c.status==='Inadimplente'}).length }
  var S = { inp:INPUT_S, btnG:BTN_PRIMARY, btnGhost:BTN_GHOST, lbl:LABEL_S, card:CARD_S, overlay:OVERLAY_S, modal:MODAL_S }
  var canEdit = auth.canEditClientes

  return (
    <div style={{ display:'flex', height:'100%', background:C.bg, fontFamily:'Inter,sans-serif' }}>
      <div style={{ width:selected?380:'100%', minWidth:selected?380:'auto', borderRight:selected?'1px solid '+C.border:'none', display:'flex', flexDirection:'column', background:'#0d0b06' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', borderBottom:'1px solid '+C.border }}>
          {[{l:'Total',v:stats.total,c:C.text},{l:'Ativos',v:stats.ativos,c:'#4ade80'},{l:'Inadimplentes',v:stats.inad,c:stats.inad>0?C.red:C.text3}].map(function(s,i){
            return <div key={i} style={{ padding:'15px 0',textAlign:'center',borderRight:i<2?'1px solid '+C.border:'none' }}>
              <div style={{ fontSize:24,fontWeight:700,color:s.c }}>{s.v}</div>
              <div style={{ fontSize:11,color:C.text3,textTransform:'uppercase',letterSpacing:'.08em',marginTop:3 }}>{s.l}</div>
            </div>
          })}
        </div>
        <div style={{ padding:'12px 14px', borderBottom:'1px solid '+C.border, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:8 }}>
            <input style={{ ...S.inp,flex:1 }} placeholder="Buscar por nome, telefone ou email..." value={search} onChange={function(e){setSearch(e.target.value)}} />
            {canEdit&&<button style={{ ...S.btnG,padding:'10px 14px',fontSize:14,whiteSpace:'nowrap' }} onClick={function(){setForm(EMPTY_CLIENT);setErro('');setModalNew(true)}}>+ Novo</button>}
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {['Todos','Ativo','Inadimplente','Concluido','Inativo'].map(function(s){
              return <button key={s} onClick={function(){setFiltStatus(s)}} style={{ padding:'5px 12px',borderRadius:6,border:'1px solid '+(filtStatus===s?'#c9a96e':C.border),background:filtStatus===s?'#1c1810':'none',color:filtStatus===s?'#c9a96e':C.text3,fontSize:13,cursor:'pointer',fontFamily:'Inter,sans-serif',fontWeight:filtStatus===s?600:400 }}>{s}</button>
            })}
          </div>
        </div>
        <div style={{ overflowY:'auto', flex:1 }}>
          {loading&&<div style={{ padding:30,textAlign:'center',color:C.text3,fontSize:15 }}>Carregando...</div>}
          {!loading&&filtrados.length===0&&<div style={{ padding:40,textAlign:'center',color:C.text3,fontSize:15,fontStyle:'italic' }}>Nenhum cliente encontrado.</div>}
          {filtrados.map(function(c){
            var active=selected&&selected.id===c.id
            return (
              <div key={c.id} onClick={function(){selecionarCliente(c)}} style={{ padding:'15px 18px',borderBottom:'1px solid '+C.border,background:active?'#1c1810':'transparent',cursor:'pointer',transition:'background .1s' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5 }}>
                  <div style={{ fontSize:16,fontWeight:600,color:C.text }}>{c.nome}</div>
                  <Badge status={c.status}/>
                </div>
                <div style={{ fontSize:14,color:C.text3 }}>{c.telefone||c.email||'Sem contato'}</div>
                <div style={{ fontSize:13,color:C.text3,marginTop:3 }}><span style={{ color:'#7a6a4a' }}>{c.origem}</span>{c.edicao&&<span style={{ marginLeft:8,color:'#c9a96e',fontWeight:500 }}>{c.edicao}</span>}</div>
              </div>
            )
          })}
        </div>
      </div>

      {selected&&(
        <div style={{ flex:1,overflowY:'auto',display:'flex',flexDirection:'column' }}>
          <div style={{ padding:'18px 24px',borderBottom:'1px solid '+C.border,background:'#0d0b06',display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontSize:22,fontWeight:700,color:C.text }}>{selected.nome}</div>
              <div style={{ fontSize:13,color:C.text3,marginTop:4,display:'flex',gap:14,flexWrap:'wrap' }}>
                {selected.email&&<span>✉ {selected.email}</span>}
                {selected.telefone&&<span>📱 {selected.telefone}</span>}
              </div>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              {canEdit&&!editando&&<button style={{ ...S.btnGhost,fontSize:13 }} onClick={function(){setEditando(true)}}>✏️ Editar</button>}
              <button style={{ ...S.btnGhost,fontSize:13 }} onClick={function(){setSelected(null);setEditando(false)}}>✕</button>
            </div>
          </div>
          <div style={{ display:'flex',borderBottom:'1px solid '+C.border,background:'#0d0b06',padding:'0 24px' }}>
            {[{id:'dados',l:'Dados'},{id:'financeiro',l:'Financeiro'},{id:'presencas',l:'Presencas'},{id:'historico',l:'Historico'}].map(function(t){
              var ac=detTab===t.id
              return <button key={t.id} onClick={function(){setDetTab(t.id)}} style={{ padding:'12px 16px',border:'none',borderBottom:ac?'2px solid #c9a96e':'2px solid transparent',background:'none',color:ac?'#c9a96e':C.text3,cursor:'pointer',fontFamily:'Inter,sans-serif',fontSize:14,fontWeight:ac?600:400 }}>{t.l}</button>
            })}
          </div>
          <div style={{ flex:1,padding:'24px',overflowY:'auto' }}>
            {detTab==='dados'&&(
              editando?(
                <div style={{ display:'flex',flexDirection:'column',gap:16 }}>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
                    <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={form.nome} onChange={function(e){setForm(function(p){return{...p,nome:e.target.value}})}}/></div>
                    <div><label style={S.lbl}>Email</label><input style={S.inp} value={form.email} onChange={function(e){setForm(function(p){return{...p,email:e.target.value}})}}/></div>
                    <div><label style={S.lbl}>Telefone</label><input style={S.inp} value={form.telefone} onChange={function(e){setForm(function(p){return{...p,telefone:e.target.value}})}}/></div>
                    <div><label style={S.lbl}>CPF</label><input style={S.inp} value={form.cpf} onChange={function(e){setForm(function(p){return{...p,cpf:e.target.value}})}}/></div>
                    <div><label style={S.lbl}>Status</label><select style={S.inp} value={form.status} onChange={function(e){setForm(function(p){return{...p,status:e.target.value}})}}>{STATUSES.map(function(s){return<option key={s}>{s}</option>})}</select></div>
                    <div><label style={S.lbl}>Origem</label><select style={S.inp} value={form.origem} onChange={function(e){setForm(function(p){return{...p,origem:e.target.value}})}}>{ORIGENS.map(function(o){return<option key={o}>{o}</option>})}</select></div>
                    <div><label style={S.lbl}>Turma / Edicao</label><input style={S.inp} value={form.edicao} onChange={function(e){setForm(function(p){return{...p,edicao:e.target.value}})}} placeholder="Ex: PQV 40"/></div>
                    <div><label style={S.lbl}>Evento de Origem</label><select style={S.inp} value={form.evento_origem_id} onChange={function(e){setForm(function(p){return{...p,evento_origem_id:e.target.value}})}}><option value="">Nenhum</option>{eventos.map(function(ev){return<option key={ev.id} value={ev.id}>{ev.nome}</option>})}</select></div>
                  </div>
                  <div><label style={S.lbl}>Observacoes</label><textarea style={{ ...S.inp,height:80,resize:'vertical' }} value={form.observacoes} onChange={function(e){setForm(function(p){return{...p,observacoes:e.target.value}})}}/></div>
                  {erro&&<div style={{ background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'10px 14px',fontSize:14,borderRadius:8 }}>{erro}</div>}
                  <div style={{ display:'flex',gap:10 }}>
                    <button style={S.btnGhost} onClick={function(){setEditando(false)}} disabled={saving}>Cancelar</button>
                    <button style={S.btnG} onClick={salvarCliente} disabled={saving}>{saving?'Salvando...':'Salvar'}</button>
                  </div>
                </div>
              ):(
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
                  {[{l:'Nome',v:selected.nome},{l:'Status',v:<Badge status={selected.status}/>},{l:'Email',v:selected.email||'—'},{l:'Telefone',v:selected.telefone||'—'},{l:'CPF',v:selected.cpf||'—'},{l:'Origem',v:selected.origem},{l:'Turma / Edicao',v:selected.edicao||'—'},{l:'Programa',v:selected.programa||'Outliers'},{l:'Data Entrada',v:fmtDate(selected.data_entrada)},{l:'Evento Origem',v:eventos.find(function(ev){return ev.id===selected.evento_origem_id}) ? eventos.find(function(ev){return ev.id===selected.evento_origem_id}).nome : '—'}].map(function(f,i){
                    return <div key={i} style={{ ...S.card,padding:'14px 16px' }}><div style={S.lbl}>{f.l}</div><div style={{ fontSize:15,color:C.text }}>{f.v}</div></div>
                  })}
                  {selected.observacoes&&<div style={{ ...S.card,padding:'14px 16px',gridColumn:'1/-1' }}><div style={S.lbl}>Observacoes</div><div style={{ fontSize:15,color:C.text2,lineHeight:1.7,whiteSpace:'pre-wrap' }}>{selected.observacoes}</div></div>}
                </div>
              )
            )}
            {detTab==='financeiro'&&(
              <div>
                {!financeiro&&<div style={{ color:C.text3,fontSize:15,fontStyle:'italic' }}>Sem dados financeiros registrados.</div>}
                {financeiro&&(
                  <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12 }}>
                      {[{l:'Valor Total',v:fmt(financeiro.valor_total)},{l:'Desconto',v:fmt(financeiro.desconto),red:true},{l:'Liquido',v:fmt(financeiro.valor_total-financeiro.desconto),gold:true}].map(function(f,i){
                        return <div key={i} style={{ ...S.card,padding:'14px 16px' }}><div style={S.lbl}>{f.l}</div><div style={{ fontSize:20,fontWeight:700,color:f.gold?'#c9a96e':f.red?C.red:C.text }}>{f.v}</div></div>
                      })}
                    </div>
                    <div style={S.card}>
                      <div style={{ padding:'12px 16px',borderBottom:'1px solid '+C.border }}><span style={{ fontSize:15,fontWeight:600,color:C.text }}>Parcelas — {financeiro.modalidade} — {financeiro.forma_pagamento}</span></div>
                      {(financeiro.parcelas||[]).map(function(p,i,arr){
                        var pago=p.status==='Pago',atrasado=p.status==='Atrasado'
                        return <div key={p.id} style={{ padding:'12px 16px',borderBottom:i<arr.length-1?'1px solid '+C.border:'none',display:'flex',alignItems:'center',gap:12 }}>
                          <span style={{ fontSize:13,color:C.text3,width:26,fontFamily:'monospace' }}>{String(p.numero).padStart(2,'0')}</span>
                          <span style={{ fontSize:17,fontWeight:600,color:C.text,flex:1 }}>{fmt(p.valor)}</span>
                          {p.vencimento&&<span style={{ fontSize:13,color:atrasado?C.red:C.text3,fontFamily:'monospace' }}>{fmtDate(p.vencimento)}</span>}
                          <span style={{ fontSize:12,fontWeight:600,padding:'3px 9px',borderRadius:20,color:pago?'#4ade80':atrasado?'#fca5a5':'#fbbf24',background:pago?'#14532d22':atrasado?'#7f1d1d22':'#78350f22' }}>{p.status}</span>
                        </div>
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {detTab==='presencas'&&(
              <div>
                {presencas.length===0&&<div style={{ color:C.text3,fontSize:15,fontStyle:'italic' }}>Nenhuma presenca registrada.</div>}
                {presencas.map(function(p){
                  return <div key={p.id} style={{ ...S.card,padding:'16px 20px',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                    <div><div style={{ fontSize:16,fontWeight:600,color:C.text }}>{p.eventos ? p.eventos.nome : 'Evento'}</div><div style={{ fontSize:13,color:C.text3,marginTop:4 }}>{fmtDate(p.eventos ? p.eventos.data_inicio : null)}</div></div>
                    <div style={{ display:'flex',gap:8 }}>
                      {p.checkin_at?<span style={{ color:'#4ade80',fontSize:14,fontWeight:600 }}>Presente</span>:<span style={{ color:C.text3,fontSize:14 }}>Ausente</span>}
                      {p.comprou&&<span style={{ color:'#c9a96e',fontSize:13,fontWeight:600,background:'#c9a96e22',padding:'3px 9px',borderRadius:20 }}>Comprou</span>}
                    </div>
                  </div>
                })}
              </div>
            )}
            {detTab==='historico'&&(
              <div>
                <div style={{ display:'flex',gap:8,marginBottom:18 }}>
                  <input style={{ ...S.inp,flex:1 }} value={novaObs} onChange={function(e){setNovaObs(e.target.value)}} placeholder="Adicionar anotacao ou observacao..." onKeyDown={function(e){if(e.key==='Enter')adicionarHistorico()}}/>
                  <button style={S.btnG} onClick={adicionarHistorico}>Adicionar</button>
                </div>
                {histDetalhes.length===0&&<div style={{ color:C.text3,fontSize:15,fontStyle:'italic' }}>Nenhum historico ainda.</div>}
                {histDetalhes.map(function(h){
                  return <div key={h.id} style={{ ...S.card,padding:'14px 18px',marginBottom:10 }}>
                    <div style={{ fontSize:15,color:C.text,lineHeight:1.7 }}>{h.descricao}</div>
                    <div style={{ fontSize:12,color:C.text3,marginTop:6 }}>{fmtDate(h.data)}</div>
                  </div>
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {modalNew&&(
        <div style={S.overlay} onClick={function(){if(!saving)setModalNew(false)}}>
          <div style={{ ...S.modal,width:600 }} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize:20,fontWeight:700,color:C.text,marginBottom:6 }}>Novo Cliente</div>
            <div style={{ fontSize:14,color:C.text3,marginBottom:22 }}>Cadastre um novo cliente no CRM.</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
              <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={form.nome} onChange={function(e){setForm(function(p){return{...p,nome:e.target.value}})}} autoFocus/></div>
              <div><label style={S.lbl}>Email</label><input style={S.inp} value={form.email} onChange={function(e){setForm(function(p){return{...p,email:e.target.value}})}}/></div>
              <div><label style={S.lbl}>Telefone</label><input style={S.inp} value={form.telefone} onChange={function(e){setForm(function(p){return{...p,telefone:e.target.value}})}}/></div>
              <div><label style={S.lbl}>CPF</label><input style={S.inp} value={form.cpf} onChange={function(e){setForm(function(p){return{...p,cpf:e.target.value}})}}/></div>
              <div><label style={S.lbl}>Status</label><select style={S.inp} value={form.status} onChange={function(e){setForm(function(p){return{...p,status:e.target.value}})}}>{STATUSES.map(function(s){return<option key={s}>{s}</option>})}</select></div>
              <div><label style={S.lbl}>Origem</label><select style={S.inp} value={form.origem} onChange={function(e){setForm(function(p){return{...p,origem:e.target.value}})}}>{ORIGENS.map(function(o){return<option key={o}>{o}</option>})}</select></div>
              <div><label style={S.lbl}>Turma / Edicao</label><input style={S.inp} value={form.edicao} onChange={function(e){setForm(function(p){return{...p,edicao:e.target.value}})}} placeholder="Ex: PQV 40"/></div>
              <div><label style={S.lbl}>Evento de Origem</label><select style={S.inp} value={form.evento_origem_id} onChange={function(e){setForm(function(p){return{...p,evento_origem_id:e.target.value}})}}><option value="">Nenhum</option>{eventos.map(function(ev){return<option key={ev.id} value={ev.id}>{ev.nome}</option>})}</select></div>
              <div><label style={S.lbl}>Data de Entrada</label><input style={S.inp} type="date" value={form.data_entrada} onChange={function(e){setForm(function(p){return{...p,data_entrada:e.target.value}})}}/></div>
            </div>
            <div style={{ marginTop:14 }}><label style={S.lbl}>Observacoes</label><textarea style={{ ...S.inp,height:70,resize:'vertical' }} value={form.observacoes} onChange={function(e){setForm(function(p){return{...p,observacoes:e.target.value}})}}/></div>
            {erro&&<div style={{ marginTop:12,background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'10px 14px',fontSize:14,borderRadius:8 }}>{erro}</div>}
            <div style={{ display:'flex',gap:10,justifyContent:'flex-end',marginTop:22 }}>
              <button style={S.btnGhost} onClick={function(){setModalNew(false)}} disabled={saving}>Cancelar</button>
              <button style={S.btnG} onClick={salvarCliente} disabled={saving}>{saving?'Salvando...':'Cadastrar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
