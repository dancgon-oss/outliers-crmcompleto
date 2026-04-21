import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, C, INPUT_S, BTN_PRIMARY, BTN_GHOST, LABEL_S, CARD_S } from '../lib/ui'

var SignaturePad = forwardRef(function(props, ref) {
  var canvasRef = useRef(null)
  var drawing = useRef(false)
  useImperativeHandle(ref, function() {
    return {
      toDataURL: function() { return canvasRef.current ? canvasRef.current.toDataURL() : '' },
      clear: function() { var ctx = canvasRef.current && canvasRef.current.getContext('2d'); if (ctx) ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height) },
      isEmpty: function() { var c = canvasRef.current; if (!c) return true; return !c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(function(v){return v!==0}) }
    }
  })
  function getPos(e, canvas) {
    var rect = canvas.getBoundingClientRect()
    var t = e.touches && e.touches[0]
    return { x:((t?t.clientX:e.clientX)-rect.left)*(canvas.width/rect.width), y:((t?t.clientY:e.clientY)-rect.top)*(canvas.height/rect.height) }
  }
  function start(e) { e.preventDefault(); drawing.current=true; var c=canvasRef.current; var ctx=c.getContext('2d'); var p=getPos(e,c); ctx.beginPath(); ctx.moveTo(p.x,p.y) }
  function draw(e) { e.preventDefault(); if(!drawing.current) return; var c=canvasRef.current; var ctx=c.getContext('2d'); ctx.strokeStyle='#c9a96e'; ctx.lineWidth=2.5; ctx.lineCap='round'; var p=getPos(e,c); ctx.lineTo(p.x,p.y); ctx.stroke() }
  function stop(e) { if(e) e.preventDefault(); drawing.current=false }
  return <canvas ref={canvasRef} width={500} height={140} style={{ border:'1px solid #2a2415',background:'#1c1810',cursor:'crosshair',touchAction:'none',display:'block',width:'100%',height:140,borderRadius:8 }} onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={draw} onTouchEnd={stop}/>
})

export default function CheckinPage() {
  var auth = useAuth()
  var [eventos, setEventos] = useState([])
  var [eventoId, setEventoId] = useState('')
  var [diaAtivo, setDiaAtivo] = useState(1)
  var [mode, setMode] = useState('scan')
  var [participante, setParticipante] = useState(null)
  var [evento, setEvento] = useState(null)
  var [checkinsDia, setCheckinsDia] = useState([])
  var [manualSearch, setManualSearch] = useState('')
  var [error, setError] = useState('')
  var [saving, setSaving] = useState(false)
  var [stats, setStats] = useState({ total:0, dia1:0, dia2:0, dia3:0 })
  var [venda, setVenda] = useState({ modalidade:'Parcelado',num_parcelas:6,valor_total:30000,desconto:0,forma_pagamento:'Asaas' })
  var sigRef = useRef(null)
  var canvasRef = useRef(null)
  var videoRef = useRef(null)
  var streamRef = useRef(null)
  var animRef = useRef(null)

  useEffect(function() {
    supabase.from('eventos').select('*').in('status',['Planejado','Em Andamento']).order('data_inicio',{ascending:false}).then(function(r){
      setEventos(r.data||[])
      if (r.data && r.data.length > 0) setEventoId(r.data[0].id)
    })
  }, [])

  useEffect(function() {
    if (eventoId) carregarStats()
  }, [eventoId, diaAtivo])

  useEffect(function() {
    if (mode !== 'scan') { stopCamera(); return }
    startCamera()
    return function() { stopCamera() }
  }, [mode])

  async function carregarStats() {
    var [rp, rcd] = await Promise.all([
      supabase.from('participantes').select('id').eq('evento_id',eventoId),
      supabase.from('checkin_dias').select('dia').eq('evento_id',eventoId)
    ])
    var ps = rp.data||[], cds = rcd.data||[]
    setStats({
      total: ps.length,
      dia1: cds.filter(function(c){return c.dia===1}).length,
      dia2: cds.filter(function(c){return c.dia===2}).length,
      dia3: cds.filter(function(c){return c.dia===3}).length,
    })
    // checkins do dia ativo
    if (eventoId) {
      var rcd2 = await supabase.from('checkin_dias').select('*,participantes(nome,telefone)').eq('evento_id',eventoId).eq('dia',diaAtivo).order('checkin_at',{ascending:false}).limit(20)
      setCheckinsDia(rcd2.data||[])
    }
  }

  async function startCamera() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
      animRef.current = requestAnimationFrame(scanFrame)
    } catch(e) { setError('Camera nao disponivel. Use a busca manual.') }
  }

  function stopCamera() {
    cancelAnimationFrame(animRef.current)
    if (streamRef.current) streamRef.current.getTracks().forEach(function(t){t.stop()})
  }

  var scanFrame = useCallback(function() {
    if (!videoRef.current||!canvasRef.current) return
    var video = videoRef.current
    if (video.readyState !== video.HAVE_ENOUGH_DATA) { animRef.current = requestAnimationFrame(scanFrame); return }
    var canvas = canvasRef.current
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    var ctx = canvas.getContext('2d')
    ctx.drawImage(video,0,0)
    var imageData = ctx.getImageData(0,0,canvas.width,canvas.height)
    if (window.jsQR) {
      var code = window.jsQR(imageData.data,imageData.width,imageData.height)
      if (code && code.data) {
        var match = code.data.match(/\/checkin\/([a-f0-9-]+)/)
        if (match) { processToken(match[1]); return }
      }
    }
    animRef.current = requestAnimationFrame(scanFrame)
  }, [])

  async function processToken(token) {
    stopCamera(); setError('')
    var r = await supabase.from('participantes').select('*,eventos(*)').eq('qr_token',token).single()
    if (r.error||!r.data) { setError('QR Code invalido.'); setTimeout(function(){setMode('scan')},1500); return }
    await registrarCheckin(r.data, r.data.eventos)
  }

  async function buscarManual() {
    if (!manualSearch.trim()) return
    setError('')
    var query = supabase.from('participantes').select('*,eventos(*)')
    if (eventoId) query = query.eq('evento_id',eventoId)
    var r = await query.or('nome.ilike.%'+manualSearch+'%,telefone.ilike.%'+manualSearch+'%').limit(1).single()
    if (r.error||!r.data) { setError('Participante nao encontrado.'); return }
    await registrarCheckin(r.data, r.data.eventos)
  }

  async function registrarCheckin(part, ev) {
    setParticipante(part); setEvento(ev)
    // Registrar checkin do dia
    var existe = await supabase.from('checkin_dias').select('id').eq('participante_id',part.id).eq('dia',diaAtivo).maybeSingle()
    if (!existe.data) {
      await supabase.from('checkin_dias').insert({ participante_id:part.id, evento_id:ev?ev.id:eventoId, dia:diaAtivo, checkin_por:auth.profile?auth.profile.id:null })
    }
    // Marcar checkin_at no participante se dia 1
    if (diaAtivo===1 && !part.checkin_at) {
      await supabase.from('participantes').update({ checkin_at:new Date().toISOString(), checkin_por:auth.profile?auth.profile.id:null }).eq('id',part.id)
    }
    setMode('success')
    carregarStats()
  }

  async function registrarVenda() {
    if (!participante) return
    setSaving(true)
    var clienteId = participante.cliente_id
    if (!clienteId) {
      var rc = await supabase.from('clientes').insert({ nome:participante.nome,email:participante.email,telefone:participante.telefone,cpf:participante.cpf,origem:'Paradigma',status:'Ativo',programa:'Outliers',evento_origem_id:evento?evento.id:eventoId,criado_por:auth.profile?auth.profile.id:null }).select().single()
      clienteId = rc.data ? rc.data.id : null
      await supabase.from('participantes').update({ cliente_id:clienteId,comprou:true }).eq('id',participante.id)
    } else {
      await supabase.from('participantes').update({ comprou:true }).eq('id',participante.id)
    }
    var n = venda.modalidade==='A Vista' ? 1 : Number(venda.num_parcelas)
    var liq = Number(venda.valor_total)-Number(venda.desconto)
    var vlr = liq/n
    var rf = await supabase.from('financeiro').insert({ cliente_id:clienteId,modalidade:venda.modalidade,valor_total:venda.valor_total,desconto:venda.desconto,forma_pagamento:venda.forma_pagamento }).select().single()
    if (rf.data) {
      await supabase.from('parcelas').insert(Array.from({length:n},function(_,i){ return { financeiro_id:rf.data.id,numero:i+1,valor:parseFloat(vlr.toFixed(2)),status:'Pendente' } }))
    }
    setParticipante(function(p){return{...p,comprou:true,_clienteId:clienteId,_finId:rf.data?rf.data.id:null}})
    setSaving(false); setMode('contrato')
  }

  async function assinarContrato() {
    if (!sigRef.current||sigRef.current.isEmpty()) { setError('Por favor, faca a assinatura.'); return }
    setSaving(true)
    await supabase.from('contratos').insert({ cliente_id:participante._clienteId||participante.cliente_id,participante_id:participante.id,texto_contrato:'Contrato Outliers — '+participante.nome+' — '+new Date().toLocaleDateString('pt-BR'),assinado:true,assinado_at:new Date().toISOString(),assinatura_dados:sigRef.current.toDataURL() })
    setSaving(false); setMode('done')
  }

  function resetar() {
    setMode('scan'); setParticipante(null); setEvento(null); setError(''); setManualSearch('')
    setVenda({ modalidade:'Parcelado',num_parcelas:6,valor_total:30000,desconto:0,forma_pagamento:'Asaas' })
  }

  var S = { btnG:BTN_PRIMARY, btnGhost:BTN_GHOST, inp:INPUT_S, lbl:LABEL_S, card:CARD_S }

  return (
    <div style={{ fontFamily:'Inter,sans-serif',background:'#0a0900',height:'100%',color:'#f0ead8',display:'flex',flexDirection:'column',overflow:'hidden' }}>

      {/* Header + seletor evento + dia */}
      <div style={{ borderBottom:'1px solid #2a2415',padding:'14px 22px',background:'#0d0b06' }}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:12 }}>
          <div style={{ fontSize:20,fontWeight:700 }}>Check-in</div>
          <div style={{ display:'flex',gap:8 }}>
            <button style={{ ...S.btnGhost,padding:'8px 14px',fontSize:13,background:mode==='scan'?'#1c1810':'none' }} onClick={function(){setMode('scan')}}>📷 Camera</button>
            <button style={{ ...S.btnGhost,padding:'8px 14px',fontSize:13,background:mode==='manual'?'#1c1810':'none' }} onClick={function(){setMode('manual')}}>🔍 Manual</button>
          </div>
        </div>
        <div style={{ display:'flex',gap:12,flexWrap:'wrap',alignItems:'center' }}>
          <select style={{ ...S.inp,width:260 }} value={eventoId} onChange={function(e){setEventoId(e.target.value)}}>
            {eventos.map(function(ev){return<option key={ev.id} value={ev.id}>{ev.nome} — {fmtDate(ev.data_inicio)}</option>})}
          </select>
          <div style={{ display:'flex',gap:6 }}>
            {[1,2,3].map(function(d){
              var ac=diaAtivo===d
              var cnt=[stats.dia1,stats.dia2,stats.dia3][d-1]
              return <button key={d} onClick={function(){setDiaAtivo(d)}} style={{ padding:'8px 18px',borderRadius:8,border:'1px solid '+(ac?'#c9a96e':'#2a2415'),background:ac?'#1c1810':'none',color:ac?'#c9a96e':'#7a6a4a',fontSize:14,fontWeight:ac?600:400,cursor:'pointer',fontFamily:'Inter,sans-serif',display:'flex',alignItems:'center',gap:6 }}>
                Dia {d} <span style={{ fontSize:12,background:'#2a2415',padding:'1px 7px',borderRadius:10,color:'#b8a882' }}>{cnt}</span>
              </button>
            })}
          </div>
          <div style={{ marginLeft:'auto',display:'flex',gap:16 }}>
            {[{l:'Total',v:stats.total},{l:'Dia 1',v:stats.dia1,c:'#4ade80'},{l:'Dia 2',v:stats.dia2,c:'#60a5fa'},{l:'Dia 3',v:stats.dia3,c:'#c9a96e'}].map(function(s,i){
              return <div key={i} style={{ textAlign:'center' }}><div style={{ fontSize:20,fontWeight:700,color:s.c||'#f0ead8' }}>{s.v}</div><div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase' }}>{s.l}</div></div>
            })}
          </div>
        </div>
      </div>

      <div style={{ flex:1,display:'flex',overflow:'hidden' }}>
        {/* Scanner area */}
        <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24 }}>
          {mode==='scan'&&(
            <div style={{ width:'100%',maxWidth:400,textAlign:'center' }}>
              <div style={{ fontSize:22,fontWeight:700,marginBottom:6 }}>Escanear QR Code</div>
              <div style={{ fontSize:14,color:'#7a6a4a',marginBottom:18 }}>Dia {diaAtivo} — Aponte para o QR do participante</div>
              <div style={{ position:'relative',background:'#000',borderRadius:12,overflow:'hidden',aspectRatio:'1',maxWidth:340,margin:'0 auto' }}>
                <video ref={videoRef} style={{ width:'100%',height:'100%',objectFit:'cover' }} playsInline muted/>
                <canvas ref={canvasRef} style={{ display:'none' }}/>
                <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none' }}>
                  <div style={{ width:220,height:220,border:'2px solid #c9a96e',borderRadius:10,boxShadow:'0 0 0 9999px rgba(0,0,0,0.5)' }}/>
                </div>
                <div style={{ position:'absolute',bottom:12,left:0,right:0,textAlign:'center' }}>
                  <span style={{ background:'rgba(0,0,0,.7)',color:'#c9a96e',fontSize:13,padding:'4px 12px',borderRadius:8,fontWeight:600 }}>Dia {diaAtivo}</span>
                </div>
              </div>
              {error&&<div style={{ marginTop:14,background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'10px 14px',fontSize:14,borderRadius:8 }}>{error}</div>}
            </div>
          )}
          {mode==='manual'&&(
            <div style={{ width:'100%',maxWidth:440 }}>
              <div style={{ fontSize:22,fontWeight:700,marginBottom:6,textAlign:'center' }}>Busca Manual</div>
              <div style={{ fontSize:14,color:'#7a6a4a',marginBottom:18,textAlign:'center' }}>Dia {diaAtivo} — Nome ou telefone do participante</div>
              <div style={{ display:'flex',gap:10 }}>
                <input style={{ ...S.inp,flex:1,fontSize:16 }} placeholder="Nome ou telefone..." value={manualSearch} onChange={function(e){setManualSearch(e.target.value)}} onKeyDown={function(e){if(e.key==='Enter')buscarManual()}}/>
                <button style={{ ...S.btnG,padding:'10px 20px' }} onClick={buscarManual}>Buscar</button>
              </div>
              {error&&<div style={{ marginTop:14,background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'10px 14px',fontSize:14,borderRadius:8 }}>{error}</div>}
            </div>
          )}
          {mode==='success'&&participante&&(
            <div style={{ width:'100%',maxWidth:460,textAlign:'center' }}>
              <div style={{ fontSize:60,marginBottom:14 }}>✅</div>
              <div style={{ fontSize:26,fontWeight:700,marginBottom:6 }}>Check-in Confirmado!</div>
              <div style={{ fontSize:18,color:'#c9a96e',fontWeight:600,marginBottom:4 }}>{participante.nome}</div>
              <div style={{ fontSize:14,color:'#7a6a4a',marginBottom:6,fontFamily:'monospace' }}>{participante.telefone}</div>
              <div style={{ fontSize:14,color:'#4ade80',fontWeight:600,marginBottom:24 }}>Dia {diaAtivo} registrado ✓</div>
              <div style={{ display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap' }}>
                <button style={S.btnGhost} onClick={resetar}>Proximo</button>
                {!participante.comprou&&<button style={S.btnG} onClick={function(){setMode('sale')}}>💰 Registrar Venda</button>}
                {participante.comprou&&<div style={{ background:'#14532d22',border:'1px solid #14532d',color:'#4ade80',padding:'10px 18px',fontSize:14,borderRadius:8 }}>Ja realizou compra ✓</div>}
              </div>
            </div>
          )}
          {mode==='sale'&&(
            <div style={{ width:'100%',maxWidth:500 }}>
              <div style={{ fontSize:20,fontWeight:700,marginBottom:4 }}>Registrar Venda</div>
              <div style={{ fontSize:15,color:'#c9a96e',fontWeight:600,marginBottom:22 }}>{participante&&participante.nome}</div>
              <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
                <div style={{ display:'flex',gap:12 }}>
                  <div style={{ flex:1 }}><label style={S.lbl}>Modalidade</label><select style={S.inp} value={venda.modalidade} onChange={function(e){setVenda(function(p){return{...p,modalidade:e.target.value}})}}><option>Parcelado</option><option>A Vista</option></select></div>
                  <div style={{ flex:1 }}><label style={S.lbl}>Pagamento</label><select style={S.inp} value={venda.forma_pagamento} onChange={function(e){setVenda(function(p){return{...p,forma_pagamento:e.target.value}})}}><option>Asaas</option><option>PIX</option><option>Cartao</option><option>Boleto</option></select></div>
                </div>
                <div style={{ display:'flex',gap:12 }}>
                  <div style={{ flex:1 }}><label style={S.lbl}>Valor Total (R$)</label><input style={S.inp} type="number" value={venda.valor_total} onChange={function(e){setVenda(function(p){return{...p,valor_total:Number(e.target.value)}})}}/></div>
                  <div style={{ flex:1 }}><label style={S.lbl}>Desconto (R$)</label><input style={S.inp} type="number" value={venda.desconto} onChange={function(e){setVenda(function(p){return{...p,desconto:Number(e.target.value)}})}}/></div>
                </div>
                {venda.modalidade==='Parcelado'&&<div style={{ width:'50%' }}><label style={S.lbl}>Num. Parcelas</label><select style={S.inp} value={venda.num_parcelas} onChange={function(e){setVenda(function(p){return{...p,num_parcelas:Number(e.target.value)}})}}>{[2,3,4,5,6,8,10,12].map(function(n){return<option key={n}>{n}</option>})}</select></div>}
                <div style={{ background:'#1c1810',border:'1px solid #2a2415',borderRadius:8,padding:'14px 18px',display:'flex',justifyContent:'space-between' }}>
                  <span style={{ color:'#7a6a4a',fontSize:14 }}>Valor liquido</span>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:22,fontWeight:700,color:'#c9a96e' }}>{fmt(venda.valor_total-venda.desconto)}</div>
                    {venda.modalidade==='Parcelado'&&<div style={{ fontSize:13,color:'#7a6a4a' }}>{venda.num_parcelas}x {fmt((venda.valor_total-venda.desconto)/venda.num_parcelas)}</div>}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex',gap:10,marginTop:22 }}>
                <button style={S.btnGhost} onClick={function(){setMode('success')}}>Voltar</button>
                <button style={{ ...S.btnG,flex:1 }} onClick={registrarVenda} disabled={saving}>{saving?'Salvando...':'Confirmar Venda'}</button>
              </div>
            </div>
          )}
          {mode==='contrato'&&(
            <div style={{ width:'100%',maxWidth:560 }}>
              <div style={{ fontSize:20,fontWeight:700,marginBottom:4 }}>Assinatura do Contrato</div>
              <div style={{ fontSize:15,color:'#c9a96e',fontWeight:600,marginBottom:18 }}>{participante&&participante.nome}</div>
              <div style={{ background:'#1c1810',border:'1px solid #2a2415',borderRadius:8,padding:'14px 16px',fontSize:13,lineHeight:1.8,color:'#b8a882',maxHeight:180,overflowY:'auto',marginBottom:16,fontFamily:'monospace' }}>
                CONTRATO DE PRESTACAO DE SERVICOS EDUCACIONAIS — PROGRAMA OUTLIERS{'\n\n'}CONTRATANTE: {participante&&participante.nome}{'\n'}Telefone: {participante&&participante.telefone}{'\n'}Data: {new Date().toLocaleDateString('pt-BR')}{'\n\n'}Valor: {fmt(venda.valor_total-venda.desconto)} em {venda.modalidade==='A Vista'?'1x':venda.num_parcelas+'x'}{'\n\n'}Ao assinar, o CONTRATANTE declara ter lido e concordado com todos os termos do Programa Outliers, incluindo acesso a plataforma, mentorias e materiais pelo periodo de 6 meses.
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={S.lbl}>Assinatura Digital</label>
                <SignaturePad ref={sigRef}/>
                <button style={{ ...S.btnGhost,marginTop:8,fontSize:12,padding:'5px 12px' }} onClick={function(){sigRef.current&&sigRef.current.clear()}}>Limpar</button>
              </div>
              {error&&<div style={{ background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'9px 13px',fontSize:13,borderRadius:8,marginBottom:12 }}>{error}</div>}
              <div style={{ display:'flex',gap:10 }}>
                <button style={S.btnGhost} onClick={function(){setMode('sale')}}>Voltar</button>
                <button style={{ ...S.btnG,flex:1 }} onClick={assinarContrato} disabled={saving}>{saving?'Salvando...':'Confirmar Assinatura'}</button>
              </div>
            </div>
          )}
          {mode==='done'&&(
            <div style={{ textAlign:'center',maxWidth:420 }}>
              <div style={{ fontSize:60,marginBottom:14 }}>🎉</div>
              <div style={{ fontSize:26,fontWeight:700,marginBottom:10 }}>Tudo Certo!</div>
              <div style={{ fontSize:15,color:'#7a6a4a',marginBottom:28,lineHeight:2.2 }}>
                Check-in registrado ✓<br/>Venda registrada ✓<br/>Contrato assinado ✓
              </div>
              <button style={{ ...S.btnG,padding:'13px 36px',fontSize:16 }} onClick={resetar}>Proximo Participante</button>
            </div>
          )}
        </div>

        {/* Sidebar: ultimos checkins do dia */}
        <div style={{ width:260,borderLeft:'1px solid #2a2415',background:'#0d0b06',display:'flex',flexDirection:'column',overflowY:'auto' }}>
          <div style={{ padding:'14px 16px',borderBottom:'1px solid #2a2415' }}>
            <div style={{ fontSize:14,fontWeight:600,color:'#f0ead8' }}>Dia {diaAtivo} — Ultimos</div>
            <div style={{ fontSize:12,color:'#7a6a4a',marginTop:2 }}>{checkinsDia.length} check-ins</div>
          </div>
          {checkinsDia.length===0&&<div style={{ padding:20,textAlign:'center',color:'#7a6a4a',fontSize:13 }}>Nenhum ainda</div>}
          {checkinsDia.map(function(cd){
            return <div key={cd.id} style={{ padding:'10px 14px',borderBottom:'1px solid #2a2415' }}>
              <div style={{ fontSize:14,fontWeight:500,color:'#f0ead8' }}>{cd.participantes ? cd.participantes.nome : '—'}</div>
              <div style={{ fontSize:11,color:'#7a6a4a',marginTop:2,fontFamily:'monospace' }}>{cd.checkin_at ? new Date(cd.checkin_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : ''}</div>
            </div>
          })}
        </div>
      </div>
    </div>
  )
}
