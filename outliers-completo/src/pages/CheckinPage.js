import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, fmtDate, C } from '../lib/ui'
import { registrarVenda } from '../lib/vendas'

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
  function draw(e) { e.preventDefault(); if(!drawing.current) return; var c=canvasRef.current; var ctx=c.getContext('2d'); ctx.strokeStyle='#c9a96e'; ctx.lineWidth=2; ctx.lineCap='round'; var p=getPos(e,c); ctx.lineTo(p.x,p.y); ctx.stroke() }
  function stop(e) { if(e) e.preventDefault(); drawing.current=false }
  return <canvas ref={canvasRef} width={500} height={130} style={{ border:'1px solid #2a2415',background:'#1c1810',cursor:'crosshair',touchAction:'none',display:'block',width:'100%',height:130,borderRadius:8 }} onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={draw} onTouchEnd={stop} />
})

// ── Helpers pra check-in multi-dia ─────────────────────────────
function hojeISO() { return new Date().toISOString().slice(0, 10) }

// Define o "dia alvo" do check-in baseado na data atual + range do evento.
// Se o operador está fazendo check-in antes do evento começar, grava no primeiro dia.
// Se o evento já encerrou, grava no último dia. No meio, grava no dia atual.
function resolveDiaAlvo(evento) {
  var hoje = hojeISO()
  var inicio = evento && evento.data_inicio ? evento.data_inicio : hoje
  var fim = evento && evento.data_fim ? evento.data_fim : inicio
  if (hoje < inicio) return inicio
  if (hoje > fim) return fim
  return hoje
}

function listaDiasEvento(evento) {
  if (!evento || !evento.data_inicio) return []
  var dias = [evento.data_inicio]
  if (!evento.data_fim || evento.data_fim === evento.data_inicio) return dias
  var d = new Date(evento.data_inicio + 'T00:00:00')
  var end = new Date(evento.data_fim + 'T00:00:00')
  while (d < end) {
    d.setDate(d.getDate() + 1)
    dias.push(d.toISOString().slice(0, 10))
  }
  return dias
}

export default function CheckinPage(props) {
  var auth = useAuth()
  var eventoIdInicial = props && props.eventoIdInicial
  var onVoltar = props && props.onVoltar
  var [mode, setMode] = useState('scan')
  var [participante, setParticipante] = useState(null)
  var [evento, setEvento] = useState(null)
  var [eventoContexto, setEventoContexto] = useState(null) // evento "fixado" via prop

  // Se veio com eventoIdInicial, busca o evento e fixa como contexto
  useEffect(function() {
    if (!eventoIdInicial) return
    supabase.from('eventos').select('*').eq('id', eventoIdInicial).maybeSingle().then(function(r) {
      if (r.data) setEventoContexto(r.data)
    })
  }, [eventoIdInicial])
  var [checkinInfo, setCheckinInfo] = useState(null) // { dia, jaTinha, historico: [{dia, checkin_at}] }
  var [manualSearch, setManualSearch] = useState('')
  var [error, setError] = useState('')
  var [saving, setSaving] = useState(false)
  var [venda, setVenda] = useState({ modalidade:'Parcelado',num_parcelas:6,valor_total:4800,desconto:0,forma_pagamento:'Asaas' })
  var sigRef = useRef(null)
  var canvasRef = useRef(null)
  var videoRef = useRef(null)
  var streamRef = useRef(null)
  var animRef = useRef(null)

  useEffect(function() {
    if (mode !== 'scan') { stopCamera(); return }
    startCamera()
    return function() { stopCamera() }
  }, [mode])

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
    if (!videoRef.current || !canvasRef.current) return
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

  // Registra check-in no dia alvo. Idempotente: se já existe, marca jaTinha=true e não duplica.
  // Mantém participantes.checkin_at (legado) populado com o 1º check-in.
  async function registrarCheckin(part, evt) {
    var userId = auth.profile ? auth.profile.id : null
    var dia = resolveDiaAlvo(evt)
    var agora = new Date().toISOString()

    var existing = await supabase.from('checkin_dias')
      .select('id, checkin_at')
      .eq('participante_id', part.id)
      .eq('dia', dia)
      .maybeSingle()

    var jaTinha = !!(existing && existing.data)

    if (!jaTinha) {
      await supabase.from('checkin_dias').insert({
        participante_id: part.id, dia: dia, checkin_at: agora, checkin_por: userId,
      })
    }

    // Mantém compat: preenche participantes.checkin_at se ainda não há nada
    if (!part.checkin_at) {
      await supabase.from('participantes')
        .update({ checkin_at: agora, checkin_por: userId })
        .eq('id', part.id)
    }

    // Busca histórico completo deste participante neste evento
    var hist = await supabase.from('checkin_dias')
      .select('dia, checkin_at')
      .eq('participante_id', part.id)
      .order('dia', { ascending: true })

    setCheckinInfo({ dia: dia, jaTinha: jaTinha, historico: hist.data || [] })
  }

  async function processToken(token) {
    stopCamera()
    setError('')
    var r = await supabase.from('participantes').select('*, eventos(*)').eq('qr_token', token).single()
    if (r.error || !r.data) { setError('QR Code invalido.'); setMode('scan'); return }
    setParticipante(r.data)
    setEvento(r.data.eventos)
    await registrarCheckin(r.data, r.data.eventos)
    setMode('success')
  }

  async function buscarManual() {
    if (!manualSearch.trim()) return
    setError('')
    var r = await supabase.from('participantes').select('*, eventos(*)').or('nome.ilike.%'+manualSearch+'%,telefone.ilike.%'+manualSearch+'%').limit(1).single()
    if (r.error || !r.data) { setError('Participante nao encontrado.'); return }
    setParticipante(r.data); setEvento(r.data.eventos)
    await registrarCheckin(r.data, r.data.eventos)
    setMode('success')
  }

  async function registrarVenda() {
    if (!participante) return
    setSaving(true)
    try {
      var resp = await registrarVenda({
        participante: participante,
        eventoId: evento ? evento.id : null,
        venda: venda,
        atualizarPrograma: 'Outliers',  // CheckinPage assume venda do programa Outliers (default)
        userId: auth.profile ? auth.profile.id : null,
      })
      setParticipante(function(p) {
        return { ...p, comprou: true, cliente_id: resp.cliente_id, _clienteId: resp.cliente_id, _finId: resp.financeiro_id }
      })
      setMode('contrato')
    } catch (e) {
      setError(e.message || 'Falha ao registrar venda')
    } finally {
      setSaving(false)
    }
  }

  async function assinarContrato() {
    if (!sigRef.current || sigRef.current.isEmpty()) { setError('Por favor, faca sua assinatura.'); return }
    setSaving(true)
    var sigData = sigRef.current.toDataURL()
    await supabase.from('contratos').insert({ cliente_id:participante._clienteId||participante.cliente_id,participante_id:participante.id,texto_contrato:'Contrato Outliers - '+participante.nome+' - '+new Date().toLocaleDateString('pt-BR'),assinado:true,assinado_at:new Date().toISOString(),assinatura_dados:sigData })
    setSaving(false)
    setMode('done')
  }

  function resetar() {
    setMode('scan'); setParticipante(null); setEvento(null); setError(''); setManualSearch('')
    setCheckinInfo(null)
    setVenda({ modalidade:'Parcelado',num_parcelas:6,valor_total:4800,desconto:0,forma_pagamento:'Asaas' })
  }

  var S = {
    btnG: { background:'linear-gradient(135deg,#c9a96e,#a07840)',color:'#0a0900',border:'none',padding:'11px 22px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:14,fontWeight:600,cursor:'pointer' },
    btnGhost: { background:'none',border:'1px solid #2a2415',color:'#b8a882',padding:'10px 18px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:13,cursor:'pointer' },
    inp: { background:'#1c1810',border:'1px solid #2a2415',color:'#f0ead8',padding:'10px 14px',fontSize:14,borderRadius:8,outline:'none',fontFamily:'Inter,sans-serif',width:'100%' },
    lbl: { display:'block',fontSize:11,fontWeight:600,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:7 },
  }

  return (
    <div style={{ fontFamily:'Inter,sans-serif',background:'#0a0900',minHeight:'100%',color:'#f0ead8',display:'flex',flexDirection:'column' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); *{box-sizing:border-box}`}</style>

      {/* Header */}
      <div style={{ borderBottom:'1px solid #2a2415',padding:'14px 22px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'#0d0b06' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {onVoltar && (
            <button onClick={onVoltar}
                    style={{ background:'#1c1810', border:'1px solid #2a2415', color:'#a08658', padding:'6px 10px', borderRadius:6, cursor:'pointer', fontSize:12, fontFamily:'Inter,sans-serif' }}
                    title="Voltar para Eventos">← Eventos</button>
          )}
          <div>
            <div style={{ fontSize:16,fontWeight:700,color:'#f0ead8' }}>Check-in</div>
            {(eventoContexto || evento) && (
              <div style={{ fontSize:12,color:'#c9a96e',fontWeight:500 }}>
                {(eventoContexto || evento).nome}
                {(eventoContexto || evento).local && <span style={{ color:'#7a6a4a', marginLeft:8 }}>· {(eventoContexto || evento).local}</span>}
              </div>
            )}
          </div>
        </div>
        <div style={{ display:'flex',gap:8 }}>
          <button style={{ ...S.btnGhost,padding:'7px 14px',fontSize:12 }} onClick={function(){setMode('scan')}}>📷 Camera</button>
          <button style={{ ...S.btnGhost,padding:'7px 14px',fontSize:12 }} onClick={function(){setMode('manual')}}>🔍 Manual</button>
        </div>
      </div>

      <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24 }}>

        {/* SCAN */}
        {mode === 'scan' && (
          <div style={{ width:'100%',maxWidth:420,textAlign:'center' }}>
            <div style={{ fontSize:20,fontWeight:700,color:'#f0ead8',marginBottom:6 }}>Escanear QR Code</div>
            <div style={{ fontSize:13,color:'#7a6a4a',marginBottom:20 }}>Aponte a camera para o QR Code do participante</div>
            <div style={{ position:'relative',background:'#000',borderRadius:12,overflow:'hidden',aspectRatio:'1',maxWidth:340,margin:'0 auto' }}>
              <video ref={videoRef} style={{ width:'100%',height:'100%',objectFit:'cover' }} playsInline muted />
              <canvas ref={canvasRef} style={{ display:'none' }} />
              <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none' }}>
                <div style={{ width:200,height:200,border:'2px solid #c9a96e',borderRadius:8,boxShadow:'0 0 0 9999px rgba(0,0,0,0.5)' }} />
              </div>
            </div>
            {error && <div style={{ marginTop:16,background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'10px 14px',fontSize:13,borderRadius:8 }}>{error}</div>}
          </div>
        )}

        {/* MANUAL */}
        {mode === 'manual' && (
          <div style={{ width:'100%',maxWidth:420 }}>
            <div style={{ fontSize:20,fontWeight:700,color:'#f0ead8',marginBottom:6,textAlign:'center' }}>Busca Manual</div>
            <div style={{ fontSize:13,color:'#7a6a4a',marginBottom:20,textAlign:'center' }}>Nome ou telefone do participante</div>
            <div style={{ display:'flex',gap:10 }}>
              <input style={{ ...S.inp,flex:1 }} placeholder="Digite o nome ou telefone..." value={manualSearch} onChange={function(e){setManualSearch(e.target.value)}} onKeyDown={function(e){if(e.key==='Enter')buscarManual()}} />
              <button style={S.btnG} onClick={buscarManual}>Buscar</button>
            </div>
            {error && <div style={{ marginTop:14,background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'10px 14px',fontSize:13,borderRadius:8 }}>{error}</div>}
          </div>
        )}

        {/* SUCCESS */}
        {mode === 'success' && participante && (
          <div style={{ width:'100%',maxWidth:460,textAlign:'center' }}>
            <div style={{ fontSize:56,marginBottom:14 }}>{checkinInfo && checkinInfo.jaTinha ? '↩️' : '✅'}</div>
            <div style={{ fontSize:24,fontWeight:700,color:'#f0ead8',marginBottom:6 }}>
              {checkinInfo && checkinInfo.jaTinha ? 'Já Fez Check-in Hoje' : 'Check-in Confirmado!'}
            </div>
            <div style={{ fontSize:18,color:'#c9a96e',marginBottom:4,fontWeight:600 }}>{participante.nome}</div>
            <div style={{ fontSize:13,color:'#7a6a4a',marginBottom:6,fontFamily:'monospace' }}>{(function(){ var d=String(participante.telefone||'').replace(/\D/g,''); if(d.length>=11)return '('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7,11); if(d.length===10)return '('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6); return participante.telefone||'' })()}</div>
            {evento && <div style={{ fontSize:13,color:'#7a6a4a',marginBottom:18 }}>📍 {evento.nome}</div>}

            {/* Dias do evento — mostra status de check-in em cada um */}
            {evento && checkinInfo && (() => {
              var dias = listaDiasEvento(evento)
              if (dias.length <= 1) return null
              var histSet = {}
              ;(checkinInfo.historico || []).forEach(function(h){ histSet[h.dia] = h.checkin_at })
              return (
                <div style={{ background:'#141209',border:'1px solid #2a2415',borderRadius:10,padding:'14px 16px',marginBottom:22,textAlign:'left' }}>
                  <div style={{ fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:10 }}>Presença por dia</div>
                  <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                    {dias.map(function(d) {
                      var marcado = !!histSet[d]
                      var isHoje = d === checkinInfo.dia
                      var p = d.split('-')
                      var label = p[2]+'/'+p[1]
                      return (
                        <div key={d} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 8px',borderRadius:6,background: isHoje ? '#1c1810' : 'transparent' }}>
                          <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                            <span style={{ width:18,display:'inline-block',color: marcado ? '#4ade80' : '#3d3420',fontWeight:700 }}>{marcado ? '✓' : '○'}</span>
                            <span style={{ fontSize:13,color: marcado ? '#f0ead8' : '#7a6a4a',fontFamily:'monospace' }}>{label}</span>
                            {isHoje && <span style={{ fontSize:10,color:'#c9a96e',textTransform:'uppercase',letterSpacing:'.1em' }}>hoje</span>}
                          </div>
                          <span style={{ fontSize:11,color:'#7a6a4a',fontFamily:'monospace' }}>
                            {marcado ? new Date(histSet[d]).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            <div style={{ display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap' }}>
              <button style={S.btnGhost} onClick={resetar}>Proximo Check-in</button>
              {!participante.comprou && <button style={S.btnG} onClick={function(){setMode('sale')}}>💰 Registrar Venda</button>}
              {participante.comprou && <div style={{ background:'#14532d22',border:'1px solid #14532d',color:'#4ade80',padding:'10px 18px',fontSize:13,borderRadius:8 }}>Ja realizou compra ✓</div>}
            </div>
          </div>
        )}

        {/* SALE */}
        {mode === 'sale' && (
          <div style={{ width:'100%',maxWidth:480 }}>
            <div style={{ fontSize:20,fontWeight:700,color:'#f0ead8',marginBottom:4 }}>Registrar Venda</div>
            <div style={{ fontSize:14,color:'#c9a96e',marginBottom:22,fontWeight:600 }}>{participante&&participante.nome}</div>
            <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
              <div style={{ display:'flex',gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Modalidade</label>
                  <select style={S.inp} value={venda.modalidade} onChange={function(e){setVenda(function(p){return {...p,modalidade:e.target.value}})}}>
                    <option>Parcelado</option><option>A Vista</option>
                  </select>
                </div>
                <div style={{ flex:1 }}><label style={S.lbl}>Pagamento</label>
                  <select style={S.inp} value={venda.forma_pagamento} onChange={function(e){setVenda(function(p){return {...p,forma_pagamento:e.target.value}})}}>
                    <option>Asaas</option><option>PIX</option><option>Cartao</option><option>Boleto</option>
                  </select>
                </div>
              </div>
              <div style={{ display:'flex',gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Valor Total (R$)</label><input style={S.inp} type="number" value={venda.valor_total} onChange={function(e){setVenda(function(p){return {...p,valor_total:Number(e.target.value)}})}} /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>Desconto (R$)</label><input style={S.inp} type="number" value={venda.desconto} onChange={function(e){setVenda(function(p){return {...p,desconto:Number(e.target.value)}})}} /></div>
              </div>
              {venda.modalidade === 'Parcelado' && (
                <div style={{ width:'50%' }}><label style={S.lbl}>Num. Parcelas</label>
                  <select style={S.inp} value={venda.num_parcelas} onChange={function(e){setVenda(function(p){return {...p,num_parcelas:Number(e.target.value)}})}}>
                    {[2,3,4,5,6,8,10,12].map(function(n){return <option key={n}>{n}</option>})}
                  </select>
                </div>
              )}
              <div style={{ background:'#1c1810',border:'1px solid #2a2415',borderRadius:8,padding:'12px 16px',display:'flex',justifyContent:'space-between' }}>
                <span style={{ color:'#7a6a4a',fontSize:13 }}>Valor liquido</span>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:20,fontWeight:700,color:'#c9a96e' }}>{fmt(venda.valor_total-venda.desconto)}</div>
                  {venda.modalidade==='Parcelado' && <div style={{ fontSize:11,color:'#7a6a4a' }}>{venda.num_parcelas}x {fmt((venda.valor_total-venda.desconto)/venda.num_parcelas)}</div>}
                </div>
              </div>
            </div>
            <div style={{ display:'flex',gap:10,marginTop:22 }}>
              <button style={S.btnGhost} onClick={function(){setMode('success')}}>Voltar</button>
              <button style={{ ...S.btnG,flex:1 }} onClick={registrarVenda} disabled={saving}>{saving?'Salvando...':'Confirmar Venda e Gerar Contrato'}</button>
            </div>
          </div>
        )}

        {/* CONTRATO */}
        {mode === 'contrato' && (
          <div style={{ width:'100%',maxWidth:560 }}>
            <div style={{ fontSize:20,fontWeight:700,color:'#f0ead8',marginBottom:4 }}>Assinatura do Contrato</div>
            <div style={{ fontSize:14,color:'#c9a96e',marginBottom:18,fontWeight:600 }}>{participante&&participante.nome}</div>
            <div style={{ background:'#1c1810',border:'1px solid #2a2415',borderRadius:8,padding:'14px 16px',fontSize:12,lineHeight:1.8,color:'#b8a882',maxHeight:200,overflowY:'auto',marginBottom:16,fontFamily:'monospace' }}>
              CONTRATO DE PRESTACAO DE SERVICOS EDUCACIONAIS — PROGRAMA OUTLIERS{'\n\n'}
              CONTRATANTE: {participante&&participante.nome}{'\n'}
              Telefone: {participante&&participante.telefone}{'\n'}
              Data: {new Date().toLocaleDateString('pt-BR')}{'\n\n'}
              Valor: {fmt(venda.valor_total-venda.desconto)} em {venda.modalidade==='A Vista'?'1x':venda.num_parcelas+'x'}{'\n\n'}
              Ao assinar abaixo, o CONTRATANTE declara ter lido e concordado com todos os termos do programa Outliers, incluindo acesso a plataforma, mentorias e materiais pelo periodo de 6 meses.
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={S.lbl}>Assinatura Digital</label>
              <SignaturePad ref={sigRef} />
              <button style={{ ...S.btnGhost,marginTop:8,fontSize:12,padding:'5px 12px' }} onClick={function(){sigRef.current&&sigRef.current.clear()}}>Limpar</button>
            </div>
            {error && <div style={{ background:'#7f1d1d22',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'9px 13px',fontSize:12,borderRadius:8,marginBottom:12 }}>{error}</div>}
            <div style={{ display:'flex',gap:10 }}>
              <button style={S.btnGhost} onClick={function(){setMode('sale')}}>Voltar</button>
              <button style={{ ...S.btnG,flex:1 }} onClick={assinarContrato} disabled={saving}>{saving?'Salvando...':'Confirmar Assinatura'}</button>
            </div>
          </div>
        )}

        {/* DONE */}
        {mode === 'done' && (
          <div style={{ textAlign:'center',maxWidth:400 }}>
            <div style={{ fontSize:56,marginBottom:16 }}>🎉</div>
            <div style={{ fontSize:24,fontWeight:700,color:'#f0ead8',marginBottom:10 }}>Tudo Certo!</div>
            <div style={{ fontSize:14,color:'#7a6a4a',marginBottom:28,lineHeight:2 }}>
              Check-in realizado ✓<br/>
              Venda registrada ✓<br/>
              Contrato assinado ✓
            </div>
            <button style={{ ...S.btnG,padding:'13px 32px' }} onClick={resetar}>Proximo Participante</button>
          </div>
        )}
      </div>
    </div>
  )
}
