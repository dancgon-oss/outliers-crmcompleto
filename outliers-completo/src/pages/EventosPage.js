import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmtDate, fmt, formatTel, unformatTel, C } from '../lib/ui'
import { registrarVenda } from '../lib/vendas'
import QRCode from 'qrcode'

export default function EventosPage(props) {
  var onNavigate = props && props.onNavigate
  var auth = useAuth()
  var [eventos, setEventos] = useState([])
  var [selected, setSelected] = useState(null)
  var [participantes, setParticipantes] = useState([])
  var [loading, setLoading] = useState(true)
  var [showNovoEvento, setShowNovoEvento] = useState(false)
  var [showNovoPart, setShowNovoPart] = useState(false)
  var [showQR, setShowQR] = useState(null)
  var [qrDataUrl, setQrDataUrl] = useState('')
  var [saving, setSaving] = useState(false)
  var [sending, setSending] = useState(false)
  var [sendResult, setSendResult] = useState(null)
  // Venda — abre modal com formulário pré-preenchido
  var [vendaPart, setVendaPart] = useState(null)
  var [vendaForm, setVendaForm] = useState({
    curso_id: '', modalidade: 'Parcelado', num_parcelas: 6,
    valor_total: 0, desconto: 0,
    forma_pagamento: 'Asaas',                  // forma "principal" (compatibilidade)
    forma_pagamento_parcelas: 'Boleto',        // forma das parcelas (restante)
    entrada_valor: 0, entrada_forma: 'PIX', entrada_paga: true,
  })
  var [vendaErr, setVendaErr] = useState('')
  var [vendaOk, setVendaOk] = useState(null)
  var [cursos, setCursos] = useState([])
  var [vendasMap, setVendasMap] = useState({}) // cliente_id -> count
  var [novoEvento, setNovoEvento] = useState({ nome: 'Paradigma', tipo: 'Paradigma', data_inicio: '', data_fim: '', local: '', descricao: '' })
  var [novoPart, setNovoPart] = useState({ nome: '', email: '', telefone: '', cpf: '' })
  var [search, setSearch] = useState('')
  var [filtroAtivo, setFiltroAtivo] = useState(null) // null | 'presentes' | 'compraram'

  useEffect(function() { fetchEventos() }, [])

  async function fetchEventos() {
    setLoading(true)
    var { data } = await supabase.from('eventos').select('*').order('data_inicio', { ascending: false })
    setEventos(data || [])
    setLoading(false)
  }

  async function fetchParticipantes(id) {
    var { data } = await supabase.from('participantes').select('*').eq('evento_id', id).order('created_at')
    var lista = data || []
    setParticipantes(lista)

    // Carrega contagem de vendas dos clientes vinculados a esses participantes
    var clienteIds = lista.map(function(p){ return p.cliente_id }).filter(Boolean)
    if (clienteIds.length) {
      var { data: fins } = await supabase.from('financeiro').select('cliente_id').in('cliente_id', clienteIds)
      var counts = {}
      ;(fins || []).forEach(function(f){ counts[f.cliente_id] = (counts[f.cliente_id] || 0) + 1 })
      setVendasMap(counts)
    } else {
      setVendasMap({})
    }
  }

  async function fetchCursos() {
    var { data } = await supabase.from('cursos').select('id,nome,slug,categoria,preco_padrao,preco_avulso,ativo').eq('ativo', true).order('ordem').order('nome')
    setCursos(data || [])
  }

  useEffect(function() { fetchCursos() }, [])

  async function salvarEvento() {
    setSaving(true)
    var { data } = await supabase.from('eventos').insert({ ...novoEvento, criado_por: auth.profile ? auth.profile.id : null }).select().single()
    if (data) { await fetchEventos(); setShowNovoEvento(false); setNovoEvento({ nome:'Paradigma',tipo:'Paradigma',data_inicio:'',data_fim:'',local:'',descricao:'' }) }
    setSaving(false)
  }

  function normTel(s) { return (s || '').replace(/\D/g, '') }
  function normNome(s) { return (s || '').trim().toLowerCase() }

  async function salvarParticipante() {
    if (!novoPart.nome || !novoPart.telefone || !selected) return
    setSaving(true)
    var nomeN = normNome(novoPart.nome)
    var telN = normTel(novoPart.telefone)
    var dup = participantes.find(function(p){ return normNome(p.nome) === nomeN || (telN && normTel(p.telefone) === telN) })
    if (dup) {
      alert('Ja existe um participante com este nome ou telefone neste evento: ' + dup.nome + ' (' + dup.telefone + ').')
      setSaving(false)
      return
    }
    await supabase.from('participantes').insert({ ...novoPart, telefone: unformatTel(novoPart.telefone) || null, evento_id: selected.id })
    await fetchParticipantes(selected.id)
    setShowNovoPart(false)
    setNovoPart({ nome:'',email:'',telefone:'',cpf:'' })
    setSaving(false)
  }

  async function chamarExclusao(payload) {
    var session = (await supabase.auth.getSession()).data.session
    var token = session ? session.access_token : null
    var resp = await fetch('/api/excluir-participantes', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload),
    })
    var data = await resp.json().catch(function(){ return {} })
    return { ok: resp.ok, data: data }
  }

  async function excluirParticipante(p) {
    if (!p || !p.id) return
    if (!window.confirm('Excluir o participante "' + p.nome + '"? Esta acao nao pode ser desfeita.')) return
    var r = await chamarExclusao({ ids: [p.id] })
    if (!r.ok) { alert('Erro ao excluir: ' + (r.data.error || 'desconhecido')); return }
    if (selected) await fetchParticipantes(selected.id)
  }

  async function excluirTodosParticipantes() {
    if (!selected) return
    if (!participantes.length) { alert('Nenhum participante para excluir.'); return }
    var msg = 'EXCLUIR TODOS os ' + participantes.length + ' participantes do evento "' + selected.nome + '"?\n\nEsta acao NAO pode ser desfeita.'
    if (!window.confirm(msg)) return
    var conf = window.prompt('Tem certeza absoluta? Digite SIM para confirmar.')
    if (conf !== 'SIM') { alert('Cancelado.'); return }
    var r = await chamarExclusao({ evento_id: selected.id, todos: true })
    if (!r.ok) { alert('Erro ao excluir: ' + (r.data.error || 'desconhecido')); return }
    alert('Excluidos: ' + (r.data.excluidos || 0))
    await fetchParticipantes(selected.id)
  }

  function abrirVenda(part) {
    setVendaPart(part)
    // Default: tenta achar curso "Outliers" ativo, senão usa o primeiro
    var defaultCurso = cursos.find(function(c){ return /outliers/i.test(c.nome) || /outliers/i.test(c.slug || '') }) || cursos[0]
    var preco = defaultCurso ? Number(defaultCurso.preco_padrao || defaultCurso.preco_avulso || 0) : 0
    setVendaForm({
      curso_id: defaultCurso ? defaultCurso.id : '',
      modalidade: 'Parcelado',
      num_parcelas: 6,
      valor_total: preco || 4800,
      desconto: 0,
      forma_pagamento: 'Asaas',
      forma_pagamento_parcelas: 'Boleto',
      entrada_valor: 0, entrada_forma: 'PIX', entrada_paga: true,
    })
    setVendaErr(''); setVendaOk(null)
  }

  function selecionarCurso(cursoId) {
    var c = cursos.find(function(x){ return x.id === cursoId })
    var preco = c ? Number(c.preco_padrao || c.preco_avulso || 0) : 0
    setVendaForm(function(p){
      return {
        ...p,
        curso_id: cursoId,
        valor_total: preco || p.valor_total,
      }
    })
  }

  async function confirmarVenda() {
    if (!vendaPart) return
    if (!vendaForm.curso_id) { setVendaErr('Escolha o curso/produto'); return }
    setSaving(true); setVendaErr('')
    try {
      // Se o curso vendido é o programa Outliers, atualiza programa do cliente
      var cursoSel = cursos.find(function(c){ return c.id === vendaForm.curso_id })
      var ehOutliers = cursoSel && (/outliers/i.test(cursoSel.nome) || /outliers/i.test(cursoSel.slug || ''))
      var resp = await registrarVenda({
        participante: vendaPart,
        eventoId: selected ? selected.id : null,
        venda: vendaForm,
        cursoId: vendaForm.curso_id,
        atualizarPrograma: ehOutliers ? 'Outliers' : null,
        userId: auth.profile ? auth.profile.id : null,
      })
      setVendaOk({ ...resp, cursoNome: cursoSel ? cursoSel.nome : '' })
      if (selected) await fetchParticipantes(selected.id)
    } catch (e) {
      setVendaErr(e.message || 'Falha ao registrar venda')
    }
    setSaving(false)
  }

  async function abrirQR(part) {
    setShowQR(part)
    var url = window.location.origin + '/checkin/' + part.qr_token
    var dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#0a0900', light: '#f0ead8' } })
    setQrDataUrl(dataUrl)
  }


  // Chama /api/enviar-qr (backend Bravos) para um batch de participantes.
  // Retorna { ..., bravosNotConfigured } quando faltam env vars do Bravos
  // (frontend cai em fallback wa.me manual).
  async function callEnviarQrApi(ids) {
    var sess = await supabase.auth.getSession()
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : ''
    if (!token) { alert('Sessão expirada. Faça login novamente.'); return null }
    try {
      var res = await fetch('/api/enviar-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ participante_ids: ids }),
      })
      var data = await res.json().catch(function(){ return {} })
      if (res.status === 503 && data && data.error === 'bravos_not_configured') {
        return { ok: false, bravosNotConfigured: true, results: [] }
      }
      if (!res.ok) throw new Error(data.error || data.detail || ('HTTP ' + res.status))
      return data
    } catch (e) {
      return { ok: false, enviados: 0, erros: ids.length, erroGeral: e.message || 'Falha na requisição', results: [] }
    }
  }

  // Fallback manual: abre wa.me com mensagem + URL do QR pré-preenchidos.
  function abrirWaMeManual(part) {
    if (!part || !part.telefone) return
    var tel = part.telefone.replace(/\D/g, '')
    if (tel.length === 11 || tel.length === 10) tel = '55' + tel
    var checkinUrl = window.location.origin + '/checkin/' + part.qr_token
    var qrImg = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=' + encodeURIComponent(checkinUrl)
    var nomeEvento = selected ? selected.nome : 'evento'
    var dataEvento = selected && selected.data_inicio ? fmtDate(selected.data_inicio) : ''
    var local = selected && selected.local ? selected.local : ''
    var msg = 'Olá, ' + (part.nome || '') + '!\n\n'
      + 'Sua inscrição em *' + nomeEvento + '* está confirmada.\n'
      + (dataEvento ? '📅 ' + dataEvento + '\n' : '')
      + (local ? '📍 ' + local + '\n' : '')
      + '\n🎫 *Seu QR Code de check-in:*\n' + qrImg + '\n\n'
      + 'Apresente esta imagem na entrada. Ou use o link direto:\n' + checkinUrl + '\n\n— Equipe Outliers'
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank')
  }

  // Envia QR individual: tenta auto via Bravos, cai em wa.me se Bravos n configurado.
  async function enviarQRWhatsApp(part) {
    if (!part || !part.telefone) { alert('Participante sem telefone cadastrado.'); return }
    if (sending) return
    setSending(true); setSendResult(null)
    var resp = await callEnviarQrApi([part.id])
    setSending(false)
    if (!resp) return
    if (resp.bravosNotConfigured) {
      // Fallback: abre WhatsApp Web com msg pre-preenchida pro operador clicar enviar
      abrirWaMeManual(part)
      setSendResult({ type: 'partial', msg: 'WhatsApp Web aberto pra envio manual (Bravos ainda não configurado).' })
      return
    }
    if (resp.erroGeral) { alert('Erro: ' + resp.erroGeral); return }
    var r0 = resp.results && resp.results[0]
    if (r0 && r0.ok) {
      setSendResult({ type: 'success', msg: 'QR enviado para ' + part.nome + ' via WhatsApp.' })
      if (selected) fetchParticipantes(selected.id)
    } else if (r0 && r0.pendente) {
      setSendResult({ type: 'partial', msg: 'Enviado pro Bravos (timeout aguardando confirmação). Provavelmente foi entregue.' })
      if (selected) fetchParticipantes(selected.id)
    } else {
      setSendResult({ type: 'error', msg: 'Falha ao enviar para ' + part.nome + ': ' + (r0 && r0.erro || 'desconhecido') })
    }
  }

  // Envia QR em lote (sequencial, 1 por vez — Bravos é síncrono com delay anti-ban).
  // O tempo total é ~8-15s por mensagem × N participantes. Browser deve ficar aberto.
  async function enviarParaTodos(alvo) {
    var base = alvo && alvo.length ? alvo : participantes
    if (!base.length) { alert('Nenhum participante.'); return }
    var comTelefone = base.filter(function(p){ return p.telefone })
    var semTelefone = base.length - comTelefone.length
    if (!comTelefone.length) { alert('Nenhum participante com telefone.'); return }
    var tempoEstimado = Math.round(comTelefone.length * 12 / 60) // ~12s por msg, em minutos
    var confirmar = window.confirm(
      'Enviar QR Code via WhatsApp para ' + comTelefone.length + ' participante(s)?'
      + '\n\nTempo estimado: ~' + tempoEstimado + ' min (Bravos espaça os envios pra evitar ban).'
      + '\nA aba precisa ficar aberta até o fim.'
      + (semTelefone ? '\n\n' + semTelefone + ' serão ignorados (sem telefone).' : '')
    )
    if (!confirmar) return

    setSending(true); setSendResult({ type: 'progress', msg: 'Iniciando envio...', totalOk: 0, totalPend: 0, totalErr: 0, total: comTelefone.length, atual: 0 })

    var totalOk = 0, totalPend = 0, totalErr = 0, detalhes = []
    for (var i = 0; i < comTelefone.length; i++) {
      var p = comTelefone[i]
      setSendResult({
        type: 'progress',
        msg: 'Enviando ' + (i+1) + '/' + comTelefone.length + ' — ' + (p.nome || ''),
        totalOk: totalOk, totalPend: totalPend, totalErr: totalErr, total: comTelefone.length, atual: i+1,
      })
      var resp = await callEnviarQrApi([p.id])
      var r0 = resp && resp.results && resp.results[0]
      if (r0 && r0.ok) totalOk++
      else if (r0 && r0.pendente) { totalPend++; detalhes.push(r0) }
      else if (r0) { totalErr++; detalhes.push(r0) }
      else if (resp && resp.erroGeral) { totalErr++; detalhes.push({ id: p.id, nome: p.nome, erro: resp.erroGeral }) }
    }
    setSending(false)
    setSendResult({
      type: totalErr === 0 ? (totalPend === 0 ? 'success' : 'partial') : (totalOk === 0 && totalPend === 0 ? 'error' : 'partial'),
      msg: 'Concluído · ✓ ' + totalOk + ' enviados'
        + (totalPend ? ' · ⏳ ' + totalPend + ' pendentes (aguardando confirmação Bravos)' : '')
        + (totalErr ? ' · ✕ ' + totalErr + ' erros' : '')
        + (semTelefone ? ' · ' + semTelefone + ' sem telefone' : ''),
      detalhes: detalhes,
    })
    if (selected) fetchParticipantes(selected.id)
  }

  var filtrados = participantes.filter(function(p) {
    var matchBusca = p.nome.toLowerCase().includes(search.toLowerCase()) || (p.telefone||'').includes(search)
    if (!matchBusca) return false
    if (filtroAtivo === 'presentes') return !!p.checkin_at
    if (filtroAtivo === 'compraram') return !!p.comprou
    return true
  })

  var stats = {
    inscritos: participantes.length,
    presentes: participantes.filter(function(p){ return p.checkin_at }).length,
    compraram: participantes.filter(function(p){ return p.comprou }).length,
  }

  var S = {
    card: { background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10 },
    inp: { background: C.bgHover, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', fontSize: 13, borderRadius: 8, outline: 'none', fontFamily: 'Inter,sans-serif', width: '100%', transition: 'border-color .15s' },
    btnG: { background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '9px 18px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '8px 16px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, cursor: 'pointer' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
    modal: { background: '#141209', border: '1px solid ' + C.border2, borderRadius: 14, padding: 28, width: 500, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' },
    lbl: { display: 'block', fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 },
  }

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter,sans-serif', background: C.bg }}>
      {/* Lista de eventos */}
      <div style={{ width: selected ? 280 : '100%', borderRight: selected ? '1px solid ' + C.border : 'none', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgCard }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Eventos</span>
          {auth.isAdmin && <button style={S.btnG} onClick={function(){setShowNovoEvento(true)}}>+ Novo</button>}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 13 }}>Carregando...</div>}
          {eventos.map(function(ev) {
            var active = selected && selected.id === ev.id
            var statusCor = ev.status === 'Em Andamento' ? '#4ade80' : ev.status === 'Encerrado' ? C.text3 : C.yellow
            return (
              <div key={ev.id} onClick={function(){ setSelected(ev); fetchParticipantes(ev.id) }}
                style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.border, background: active ? C.bgHover : 'transparent', cursor: 'pointer', transition: 'background .1s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{ev.nome}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusCor, background: statusCor + '22', padding: '2px 8px', borderRadius: 20 }}>{ev.status}</span>
                </div>
                <div style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace' }}>{fmtDate(ev.data_inicio)}{ev.data_fim ? ' → ' + fmtDate(ev.data_fim) : ''}</div>
                {ev.local && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>📍 {ev.local}</div>}
              </div>
            )
          })}
          {!loading && eventos.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum evento.</div>}
        </div>
      </div>

      {/* Detalhe */}
      {selected && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid ' + C.border, background: C.bgCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{selected.nome}</div>
              <div style={{ fontSize: 12, color: C.text3, marginTop: 3, fontFamily: 'monospace' }}>{fmtDate(selected.data_inicio)}{selected.local ? ' · ' + selected.local : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {auth.canCheckin && onNavigate && (
                <button style={{ ...S.btnG, padding: '8px 14px', fontSize: 12, display:'flex', alignItems:'center', gap:6 }}
                        onClick={function(){ onNavigate('checkin', { eventoId: selected.id }) }}
                        title="Abrir tela de check-in para este evento">
                  📍 Check-in
                </button>
              )}
              {auth.isAdmin && (
                <select style={{ ...S.inp, width: 160 }} value={selected.status}
                  onChange={async function(e) {
                    await supabase.from('eventos').update({ status: e.target.value }).eq('id', selected.id)
                    setEventos(function(prev){ return prev.map(function(ev){ return ev.id === selected.id ? {...ev,status:e.target.value} : ev }) })
                    setSelected(function(prev){ return {...prev,status:e.target.value} })
                  }}>
                  {['Planejado','Em Andamento','Encerrado'].map(function(s){ return <option key={s}>{s}</option> })}
                </select>
              )}
              <button style={S.btnGhost} onClick={function(){setSelected(null)}}>✕</button>
            </div>
          </div>

          {/* Stats (cards clicaveis funcionam como filtros) */}
          <div style={{ display: 'flex', borderBottom: '1px solid ' + C.border }}>
            {[
              { label: 'Inscritos', value: stats.inscritos, icon: '👥', filter: null },
              { label: 'Presentes', value: stats.presentes, icon: '✅', pct: stats.inscritos ? Math.round(stats.presentes/stats.inscritos*100) : 0, filter: 'presentes' },
              { label: 'Compraram', value: stats.compraram, icon: '💰', gold: true, filter: 'compraram' },
              { label: 'Conversao', value: stats.inscritos ? Math.round(stats.compraram/stats.inscritos*100) + '%' : '0%', icon: '📈', gold: true },
            ].map(function(s, i) {
              var clickable = s.filter !== undefined
              var active = clickable && filtroAtivo === s.filter && (s.filter !== null || filtroAtivo === null)
              // "Inscritos" (filter:null) so e' "ativo" visualmente quando nao ha filtro
              var isInscritos = s.filter === null
              var showActive = clickable && (isInscritos ? filtroAtivo === null : filtroAtivo === s.filter)
              return (
                <div key={i}
                  onClick={clickable ? function(){ setFiltroAtivo(isInscritos ? null : (filtroAtivo === s.filter ? null : s.filter)) } : undefined}
                  title={clickable ? (isInscritos ? 'Mostrar todos' : (showActive ? 'Clique para limpar o filtro' : 'Filtrar por ' + s.label.toLowerCase())) : undefined}
                  style={{
                    flex: 1, padding: '14px 18px',
                    borderRight: i < 3 ? '1px solid ' + C.border : 'none',
                    textAlign: 'center',
                    cursor: clickable ? 'pointer' : 'default',
                    background: showActive ? C.bgHover : 'transparent',
                    borderTop: showActive ? '2px solid ' + C.gold : '2px solid transparent',
                    transition: 'background .15s, border-color .15s',
                    userSelect: 'none',
                  }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.gold ? C.gold : (showActive ? C.gold : C.text) }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: showActive ? C.gold : C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2, fontWeight: showActive ? 700 : 600 }}>{s.label}</div>
                  {s.pct !== undefined && <div style={{ fontSize: 10, color: C.text3, marginTop: 1 }}>{s.pct}%</div>}
                </div>
              )
            })}
          </div>

          {/* Participantes */}
          <div style={{ padding: '16px 22px', flex: 1, overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input style={{ ...S.inp, flex: 1, minWidth: 180 }} placeholder="Buscar participante..." value={search} onChange={function(e){setSearch(e.target.value)}} />
              <button style={S.btnG} onClick={function(){setShowNovoPart(true)}}>+ Participante</button>
              <label style={{ ...S.btnGhost, padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                📂 CSV
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={async function(e) {
                  var file = e.target.files[0]; if (!file || !selected) { e.target.value = ''; return }
                  var text = await file.text()
                  var lines = text.split('\n').filter(Boolean).slice(1)
                  var rows = lines.map(function(l) {
                    var cols = l.split(',').map(function(c){ return c.trim().replace(/^"|"$/g,'') })
                    return { nome: cols[0], email: cols[1], telefone: cols[2], cpf: cols[3], evento_id: selected.id }
                  }).filter(function(r){ return r.nome && r.telefone })

                  // Deduplicacao: contra existentes e dentro do proprio CSV
                  var nomesExist = new Set(participantes.map(function(p){ return normNome(p.nome) }))
                  var telsExist = new Set(participantes.map(function(p){ return normTel(p.telefone) }).filter(Boolean))
                  var nomesNovos = new Set()
                  var telsNovos = new Set()
                  var inseridos = []
                  var duplicados = []
                  rows.forEach(function(r){
                    var n = normNome(r.nome)
                    var t = normTel(r.telefone)
                    if (nomesExist.has(n) || (t && telsExist.has(t)) || nomesNovos.has(n) || (t && telsNovos.has(t))) {
                      duplicados.push(r.nome + ' (' + r.telefone + ')')
                    } else {
                      inseridos.push(r)
                      nomesNovos.add(n)
                      if (t) telsNovos.add(t)
                    }
                  })

                  if (inseridos.length) {
                    var ins = await supabase.from('participantes').insert(inseridos)
                    if (ins.error) { alert('Erro ao importar: ' + ins.error.message); e.target.value = ''; return }
                  }
                  await fetchParticipantes(selected.id)
                  var msg = 'Importacao concluida.\n\n' + inseridos.length + ' inserido(s).'
                  if (duplicados.length) msg += '\n' + duplicados.length + ' ignorado(s) por duplicidade (mesmo nome ou telefone).'
                  alert(msg)
                  e.target.value = ''
                }} />
              </label>
              <button
                style={{ ...S.btnGhost, padding: '9px 14px', opacity: sending ? 0.6 : 1, cursor: sending ? 'wait' : 'pointer' }}
                disabled={sending}
                onClick={function(){ enviarParaTodos(participantes.filter(function(p){ return !p.qr_enviado_em })) }}
                title="Envia QR por WhatsApp para quem ainda não recebeu"
              >📱 Enviar QR (pendentes)</button>
              <button
                style={{ ...S.btnGhost, padding: '9px 14px', opacity: sending ? 0.6 : 1, cursor: sending ? 'wait' : 'pointer' }}
                disabled={sending}
                onClick={function(){ enviarParaTodos(participantes) }}
                title="Reenvia para todos os participantes com telefone"
              >📱 Enviar QR (todos)</button>
              <button
                style={{ ...S.btnGhost, padding: '9px 14px', color:'#fca5a5', borderColor:'#7f1d1d' }}
                onClick={excluirTodosParticipantes}
                title="Apaga TODOS os participantes deste evento"
              >🗑️ Excluir todos</button>
            </div>

            {sending && sendResult && sendResult.type === 'progress' && (
              <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 8, background: C.bgCard, border: '1px solid ' + C.border2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.gold, marginBottom: 8 }}>
                  <span>{sendResult.msg}</span>
                  <span style={{ fontFamily: 'monospace', color: C.text2 }}>{sendResult.atual}/{sendResult.total}</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: (sendResult.total ? Math.round(sendResult.atual / sendResult.total * 100) : 0) + '%',
                    background: 'linear-gradient(90deg,#c9a96e,#a07840)',
                    transition: 'width .25s',
                  }} />
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: C.text3 }}>
                  <span>✓ Enviados: <b style={{ color: '#4ade80' }}>{sendResult.totalOk}</b></span>
                  {!!sendResult.totalPend && <span>⏳ Pendentes: <b style={{ color: C.yellow }}>{sendResult.totalPend}</b></span>}
                  <span>✕ Erros: <b style={{ color: '#fca5a5' }}>{sendResult.totalErr}</b></span>
                </div>
              </div>
            )}
            {sending && (!sendResult || sendResult.type !== 'progress') && (
              <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: C.bgCard, border: '1px solid ' + C.border2, fontSize: 13, color: C.gold }}>
                Enviando QR Code via WhatsApp...
              </div>
            )}
            {sendResult && !sending && sendResult.type !== 'progress' && (
              <div style={{
                marginBottom: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: sendResult.type === 'success' ? '#14532d22' : (sendResult.type === 'partial' ? '#78350f22' : '#7f1d1d22'),
                border: '1px solid ' + (sendResult.type === 'success' ? '#14532d' : (sendResult.type === 'partial' ? '#78350f' : '#7f1d1d')),
                color: sendResult.type === 'success' ? '#4ade80' : (sendResult.type === 'partial' ? C.yellow : '#fca5a5'),
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <span>{sendResult.msg}</span>
                <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13 }} onClick={function(){ setSendResult(null) }}>✕</button>
              </div>
            )}

            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.6fr) 150px 100px 100px 130px 70px 110px', padding: '10px 16px', borderBottom: '1px solid ' + C.border }}>
                {['Nome','Telefone','Check-in','QR WhatsApp','Vendas','Contrato','Ações'].map(function(h,i){ return <span key={i} style={{ fontSize: 10, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span> })}
              </div>
              {filtrados.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum participante.</div>}
              {filtrados.map(function(p, i, arr) {
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.6fr) 150px 100px 100px 130px 70px 110px', padding: '11px 16px', borderBottom: i < arr.length-1 ? '1px solid ' + C.border : 'none', alignItems: 'center', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: C.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={p.nome}>{p.nome}</div>
                      {p.email && <div style={{ fontSize: 11, color: C.text3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={p.email}>{p.email}</div>}
                    </div>
                    <div style={{ fontSize: 12, color: C.text2, fontFamily: 'monospace' }}>{formatTel(p.telefone)}</div>
                    <div style={{ fontSize: 11 }}>
                      {p.checkin_at
                        ? <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ {new Date(p.checkin_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
                        : <span style={{ color: C.text3 }}>Pendente</span>}
                    </div>
                    <div style={{ fontSize: 11 }}>
                      {p.qr_enviado_em
                        ? <span title={new Date(p.qr_enviado_em).toLocaleString('pt-BR')} style={{ color: '#4ade80', fontWeight: 600 }}>✓ Enviado</span>
                        : <span style={{ color: C.text3 }}>—</span>}
                    </div>
                    <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {(function(){
                        var n = (p.cliente_id && vendasMap[p.cliente_id]) || 0
                        return n > 0 ? <span style={{ color: C.gold, fontWeight: 600 }} title={n + ' venda(s) registrada(s)'}>{n}×</span> : null
                      })()}
                      <button onClick={function(){ abrirVenda(p) }}
                        style={{ background:'#14532d22', border:'1px solid #14532d', color:'#4ade80', padding:'3px 8px', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:600, fontFamily:'Inter,sans-serif' }}>
                        + Vender
                      </button>
                    </div>
                    <div style={{ fontSize: 11 }}>{p.comprou ? <span style={{ color: '#4ade80' }}>✓</span> : <span style={{ color: C.text3 }}>—</span>}</div>
                    <div style={{ display:'flex', gap:4 }}>
                      <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 11 }} onClick={function(){ abrirQR(p) }}>QR ↗</button>
                      <button
                        style={{ ...S.btnGhost, padding: '4px 8px', fontSize: 11, color:'#fca5a5', borderColor:'#7f1d1d' }}
                        onClick={function(){ excluirParticipante(p) }}
                        title="Excluir participante"
                      >🗑️</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Novo Evento */}
      {showNovoEvento && (
        <div style={S.overlay} onClick={function(){setShowNovoEvento(false)}}>
          <div style={S.modal} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 22 }}>Novo Evento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={S.lbl}>Nome</label><input style={S.inp} value={novoEvento.nome} onChange={function(e){setNovoEvento(function(p){return {...p,nome:e.target.value}})}} /></div>
              <div style={{ display:'flex', gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Data Inicio</label><input style={S.inp} type="date" value={novoEvento.data_inicio} onChange={function(e){setNovoEvento(function(p){return {...p,data_inicio:e.target.value}})}} /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>Data Fim</label><input style={S.inp} type="date" value={novoEvento.data_fim} onChange={function(e){setNovoEvento(function(p){return {...p,data_fim:e.target.value}})}} /></div>
              </div>
              <div><label style={S.lbl}>Local</label><input style={S.inp} value={novoEvento.local} onChange={function(e){setNovoEvento(function(p){return {...p,local:e.target.value}})}} /></div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:22 }}>
              <button style={S.btnGhost} onClick={function(){setShowNovoEvento(false)}}>Cancelar</button>
              <button style={S.btnG} onClick={salvarEvento} disabled={saving||!novoEvento.data_inicio}>{saving?'Salvando...':'Criar Evento'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Novo Participante */}
      {showNovoPart && (
        <div style={S.overlay} onClick={function(){setShowNovoPart(false)}}>
          <div style={S.modal} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 22 }}>Adicionar Participante</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label style={S.lbl}>Nome *</label><input style={S.inp} value={novoPart.nome} onChange={function(e){setNovoPart(function(p){return {...p,nome:e.target.value}})}} /></div>
              <div style={{ display:'flex', gap:12 }}>
                <div style={{ flex:1 }}><label style={S.lbl}>Telefone *</label><input style={S.inp} value={novoPart.telefone} onChange={function(e){setNovoPart(function(p){return {...p,telefone:e.target.value}})}} placeholder="(11) 98765-4321" /></div>
                <div style={{ flex:1 }}><label style={S.lbl}>CPF</label><input style={S.inp} value={novoPart.cpf} onChange={function(e){setNovoPart(function(p){return {...p,cpf:e.target.value}})}} /></div>
              </div>
              <div><label style={S.lbl}>E-mail</label><input style={S.inp} type="email" value={novoPart.email} onChange={function(e){setNovoPart(function(p){return {...p,email:e.target.value}})}} /></div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:22 }}>
              <button style={S.btnGhost} onClick={function(){setShowNovoPart(false)}}>Cancelar</button>
              <button style={S.btnG} onClick={salvarParticipante} disabled={saving||!novoPart.nome||!novoPart.telefone}>{saving?'Salvando...':'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Vender Outliers */}
      {vendaPart && (
        <div style={S.overlay} onClick={function(){ if (!saving) { setVendaPart(null); setVendaOk(null) } }}>
          <div style={S.modal} onClick={function(e){ e.stopPropagation() }}>
            {!vendaOk ? (<>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>Registrar venda</div>
              <div style={{ fontSize: 13, color: C.gold, marginBottom: 18 }}>{vendaPart.nome} · {vendaPart.telefone}</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={S.lbl}>Curso / Produto *</label>
                  <select style={S.inp} value={vendaForm.curso_id} onChange={function(e){ selecionarCurso(e.target.value) }}>
                    <option value="">— escolha um produto —</option>
                    {cursos.map(function(c) {
                      var preco = c.preco_padrao || c.preco_avulso
                      return (
                        <option key={c.id} value={c.id}>
                          {c.nome}{c.categoria ? ' (' + c.categoria + ')' : ''}{preco ? ' — ' + fmt(preco) : ''}
                        </option>
                      )
                    })}
                  </select>
                  {!cursos.length && <div style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>Nenhum curso cadastrado. Crie em <b>Cursos</b> primeiro.</div>}
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={S.lbl}>Valor total (R$)</label>
                    <input style={S.inp} type="number" step="0.01" value={vendaForm.valor_total} onChange={function(e){ setVendaForm(function(p){ return { ...p, valor_total: Number(e.target.value) } }) }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={S.lbl}>Desconto (R$)</label>
                    <input style={S.inp} type="number" step="0.01" value={vendaForm.desconto} onChange={function(e){ setVendaForm(function(p){ return { ...p, desconto: Number(e.target.value) } }) }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={S.lbl}>Modalidade</label>
                    <select style={S.inp} value={vendaForm.modalidade} onChange={function(e){ setVendaForm(function(p){ return { ...p, modalidade: e.target.value } }) }}>
                      <option>Parcelado</option><option>A Vista</option>
                    </select>
                  </div>
                </div>

                {/* ENTRADA */}
                <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontWeight: 600 }}>Entrada (opcional)</div>
                  <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                    <div style={{ flex:'1 1 130px' }}>
                      <label style={S.lbl}>Valor da entrada (R$)</label>
                      <input style={S.inp} type="number" step="0.01" value={vendaForm.entrada_valor} onChange={function(e){ setVendaForm(function(p){ return { ...p, entrada_valor: Number(e.target.value) } }) }} placeholder="0,00" />
                    </div>
                    <div style={{ flex:'1 1 130px' }}>
                      <label style={S.lbl}>Forma da entrada</label>
                      <select style={S.inp} value={vendaForm.entrada_forma} onChange={function(e){ setVendaForm(function(p){ return { ...p, entrada_forma: e.target.value } }) }}>
                        <option>PIX</option><option>Cartão</option><option>Boleto</option><option>Dinheiro</option><option>Transferência</option>
                      </select>
                    </div>
                    <div style={{ flex:'1 1 130px', display:'flex', alignItems:'flex-end' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:C.text2, padding:'10px 0' }}>
                        <input type="checkbox" checked={vendaForm.entrada_paga} onChange={function(e){ setVendaForm(function(p){ return { ...p, entrada_paga: e.target.checked } }) }} />
                        Entrada já recebida
                      </label>
                    </div>
                  </div>
                </div>

                {/* PARCELAS DO RESTANTE */}
                {vendaForm.modalidade === 'Parcelado' && (
                  <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontWeight: 600 }}>Parcelas do restante</div>
                    <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                      <div style={{ flex:'1 1 120px' }}>
                        <label style={S.lbl}>Número de parcelas</label>
                        <select style={S.inp} value={vendaForm.num_parcelas} onChange={function(e){ setVendaForm(function(p){ return { ...p, num_parcelas: Number(e.target.value) } }) }}>
                          {[1,2,3,4,5,6,7,8,9,10,11,12,15,18,24].map(function(n){ return <option key={n} value={n}>{n}x</option> })}
                        </select>
                      </div>
                      <div style={{ flex:'1 1 130px' }}>
                        <label style={S.lbl}>Forma das parcelas</label>
                        <select style={S.inp} value={vendaForm.forma_pagamento_parcelas} onChange={function(e){ setVendaForm(function(p){ return { ...p, forma_pagamento_parcelas: e.target.value } }) }}>
                          <option>Boleto</option><option>Cartão</option><option>PIX</option><option>Asaas</option><option>Transferência</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Resumo */}
                {(function() {
                  var liq = vendaForm.valor_total - vendaForm.desconto
                  var ent = Number(vendaForm.entrada_valor || 0)
                  var rest = liq - ent
                  var nParc = vendaForm.modalidade === 'A Vista' ? 0 : Number(vendaForm.num_parcelas || 0)
                  var unit = nParc > 0 ? rest / nParc : 0
                  return (
                    <div style={{ background: C.bgHover, border: '1px solid ' + C.border, borderRadius: 8, padding: '12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Valor líquido</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: C.gold }}>{fmt(liq)}</div>
                        </div>
                        {ent > 0 && (
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize: 11, color: C.text3 }}>Entrada {vendaForm.entrada_forma}</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#4ade80' }}>{fmt(ent)}</div>
                          </div>
                        )}
                        {nParc > 0 && rest > 0 && (
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize: 11, color: C.text3 }}>+ {nParc}x {vendaForm.forma_pagamento_parcelas}</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fmt(unit)}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
                <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.5 }}>
                  Ao confirmar, vamos: criar/atualizar o cliente <b>{vendaPart.nome}</b> no CRM, marcar como comprador,
                  gerar a venda{Number(vendaForm.entrada_valor) > 0 ? ' com entrada de ' + fmt(Number(vendaForm.entrada_valor)) + ' (' + vendaForm.entrada_forma + ')' : ''}
                  {' '}{vendaForm.modalidade === 'A Vista' ? 'em parcela única' : 'e ' + vendaForm.num_parcelas + ' parcelas mensais (' + vendaForm.forma_pagamento_parcelas + ')'}.
                </div>
              </div>

              {vendaErr && <div style={{ marginTop: 14, background: '#7f1d1d22', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', fontSize: 13, borderRadius: 8 }}>{vendaErr}</div>}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
                <button style={S.btnGhost} onClick={function(){ setVendaPart(null) }} disabled={saving}>Cancelar</button>
                <button style={S.btnG} onClick={confirmarVenda} disabled={saving || !vendaForm.valor_total}>{saving ? 'Salvando...' : 'Confirmar venda'}</button>
              </div>
            </>) : (<>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>🎉</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 6 }}>Venda registrada!</div>
                <div style={{ fontSize: 13, color: C.text2 }}>{vendaPart.nome} comprou <b style={{ color: C.gold }}>{vendaOk.cursoNome || 'o produto'}</b>.</div>
              </div>
              <div style={{ background: C.bgHover, border: '1px solid ' + C.border, borderRadius: 8, padding: '14px 16px', fontSize: 13, color: C.text2, lineHeight: 1.7 }}>
                ✓ Cliente {vendaOk.cliente_id === vendaPart.cliente_id ? 'atualizado' : 'criado'} no CRM (pipeline = Ganho)<br/>
                ✓ Registro financeiro criado<br/>
                ✓ {vendaOk.parcelas} parcela{vendaOk.parcelas !== 1 ? 's' : ''} com vencimento mensal (1ª = entrada na data de hoje)
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: C.text3, lineHeight: 1.5 }}>
                Próximos passos: vá em <b>Financeiro → {vendaPart.nome}</b> e clique em <b>"+ Emitir N pendentes"</b> pra gerar as cobranças no Asaas.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                <button style={S.btnG} onClick={function(){ setVendaPart(null); setVendaOk(null) }}>Fechar</button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* MODAL: QR Code */}
      {showQR && (
        <div style={S.overlay} onClick={function(){setShowQR(null)}}>
          <div style={{ ...S.modal, width:340, textAlign:'center' }} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize:18,fontWeight:700,color:C.text,marginBottom:4 }}>{showQR.nome}</div>
            <div style={{ fontSize:12,color:C.text3,marginBottom:20,fontFamily:'monospace' }}>{showQR.telefone}</div>
            {qrDataUrl && <div style={{ background:'#f0ead8',padding:16,display:'inline-block',borderRadius:8,marginBottom:16 }}><img src={qrDataUrl} alt="QR" style={{ width:220,height:220,display:'block' }} /></div>}
            <div style={{ fontSize:12,color:C.text3,marginBottom:20,lineHeight:1.6 }}>QR Code unico para check-in no evento.</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <button style={S.btnGhost} onClick={function(){setShowQR(null)}}>Fechar</button>
              <button style={S.btnG} onClick={function(){ var a=document.createElement('a'); a.download='qr-'+showQR.nome.replace(/\s+/g,'-')+'.png'; a.href=qrDataUrl; a.click() }}>⬇ Baixar</button>
              <button
                disabled={sending}
                onClick={function(){ enviarQRWhatsApp(showQR) }}
                style={{ background:'#14532d',border:'1px solid #16a34a',color:'#4ade80',padding:'9px 16px',borderRadius:8,fontFamily:'Inter,sans-serif',fontSize:13,fontWeight:600,cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.6 : 1 }}
              >📱 {sending ? 'Enviando...' : (showQR.qr_enviado_em ? 'Reenviar' : 'WhatsApp')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
