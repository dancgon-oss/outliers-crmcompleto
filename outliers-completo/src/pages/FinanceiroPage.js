import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, formatTel, diasAteVencer, C, PARC_C, ASAAS_STATUS_PT } from '../lib/ui'
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
  var [massLoading, setMassLoading] = useState(false)
  var [massProgress, setMassProgress] = useState(null) // { atual, total, ok, err, msg }

  // ── Contratos / ZapSign ──
  var [contratos, setContratos] = useState([])
  var [showEnviarContrato, setShowEnviarContrato] = useState(false)
  var [contratoForm, setContratoForm] = useState({ doc_name:'', signer_nome:'', signer_email:'', pdf_base64:'', pdf_filename:'' })
  var [enviandoContrato, setEnviandoContrato] = useState(false)

  async function carregarContratos(finId) {
    if (!finId) { setContratos([]); return }
    var r = await supabase.from('contratos').select('*').eq('financeiro_id', finId).order('created_at', { ascending: false })
    setContratos(r.data || [])
  }

  async function handleArquivoContrato(e) {
    var file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > 9 * 1024 * 1024) { alert('PDF maior que 9MB. Comprima antes.'); e.target.value = ''; return }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { alert('Envie um arquivo PDF.'); e.target.value = ''; return }
    var arr = new Uint8Array(await file.arrayBuffer())
    var bin = ''
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
    var b64 = btoa(bin)
    setContratoForm(function(p){ return { ...p, pdf_base64: b64, pdf_filename: file.name } })
  }

  async function abrirEnvioContrato() {
    if (!financeiro || !selected) return
    setContratoForm({
      doc_name: 'Contrato Outliers - ' + (selected.nome || ''),
      signer_nome: selected.nome || '',
      signer_email: selected.email || '',
      pdf_base64: '',
      pdf_filename: '',
    })
    setShowEnviarContrato(true)
  }

  async function enviarContrato() {
    if (!financeiro) return
    if (!contratoForm.signer_nome.trim() || !contratoForm.signer_email.trim()) { alert('Nome e e-mail do signatário obrigatórios.'); return }
    if (!contratoForm.pdf_base64) { alert('Anexe o PDF do contrato.'); return }
    setEnviandoContrato(true)
    try {
      var session = (await supabase.auth.getSession()).data.session
      var token = session ? session.access_token : null
      var resp = await fetch('/api/criar-contrato-zapsign', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          financeiro_id: financeiro.id,
          doc_name: contratoForm.doc_name,
          signer_nome: contratoForm.signer_nome.trim(),
          signer_email: contratoForm.signer_email.trim().toLowerCase(),
          pdf_base64: contratoForm.pdf_base64,
        }),
      })
      var data = await resp.json().catch(function(){ return {} })
      if (!resp.ok) { alert('Erro: ' + (data.error || resp.status)); setEnviandoContrato(false); return }
      alert('Contrato enviado!\n\nO ZapSign mandou o link de assinatura por e-mail para ' + contratoForm.signer_email + '.\n\nVocê pode acompanhar o status nesta tela.')
      setShowEnviarContrato(false)
      await carregarContratos(financeiro.id)
    } catch (e) { alert('Erro: ' + (e.message || e)) }
    setEnviandoContrato(false)
  }

  async function reenviarLink(c) {
    if (!c.link_assinatura) { alert('Sem link de assinatura.'); return }
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(c.link_assinatura); alert('Link copiado para a área de transferência!') } catch(_e) { alert('Link: ' + c.link_assinatura) }
    } else {
      window.prompt('Copie o link de assinatura:', c.link_assinatura)
    }
  }

  async function excluirContrato(c) {
    if (!window.confirm('Remover este registro de contrato?\n\nO documento no ZapSign não é apagado por aqui.')) return
    var r = await supabase.from('contratos').delete().eq('id', c.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    carregarContratos(financeiro.id)
  }

  useEffect(function(){ carregarContratos(financeiro && financeiro.id) }, [financeiro && financeiro.id])

  // ── Comissionados ──
  var [comissoes, setComissoes] = useState([])
  var [aplicandoRegras, setAplicandoRegras] = useState(false)

  async function adicionarParcela() {
    if (!financeiro) return
    var todas = financeiro.parcelas || []
    var maxNumero = todas.reduce(function(m,p){ return Math.max(m, Number(p.numero || 0)) }, 0)
    var ultima = todas.slice().sort(function(a,b){ return Number(b.numero||0) - Number(a.numero||0) })[0]
    var proxData = new Date()
    if (ultima && ultima.vencimento) {
      var d = new Date(String(ultima.vencimento).slice(0,10) + 'T00:00:00')
      var diaAlvo = d.getDate()
      d.setDate(1); d.setMonth(d.getMonth() + 1)
      var ult = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
      d.setDate(Math.min(diaAlvo, ult))
      proxData = d
    } else {
      proxData.setMonth(proxData.getMonth() + 1)
    }
    var novo = {
      financeiro_id: financeiro.id,
      numero: maxNumero + 1,
      valor: 0,
      vencimento: proxData.toISOString().slice(0,10),
      status: 'Pendente',
      forma_pagamento: ultima ? ultima.forma_pagamento : null,
    }
    var r = await supabase.from('parcelas').insert(novo).select()
    if (r.error) { alert('Erro ao adicionar parcela: ' + r.error.message); return }
    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
    setFinanceiro(fin)
  }

  // ── Auto-balancear parcelas ──
  var [autoBalancear, setAutoBalancear] = useState(true)

  // ── Edição em rascunho de parcelas (só salva ao clicar Salvar) ──
  // Cada entry tem _userFixed = true quando foi alterada pelo usuário
  // (vs auto-balancear). Auto-balancear só ajusta as que NÃO estão fixadas.
  var [pendingEdits, setPendingEdits] = useState({})
  var [savingEdits, setSavingEdits] = useState(false)

  function updatePending(id, field, value) {
    setPendingEdits(function(prev) {
      var atual = prev[id] || {}
      var next = { ...prev, [id]: { ...atual, [field]: value, _userFixed: true } }
      // Se valor foi alterado e auto-balancear estiver ON, redistribui o restante
      // entre as parcelas pendentes que NÃO foram fixadas pelo usuário.
      if (field === 'valor' && autoBalancear && financeiro) {
        var liq = Number(financeiro.valor_total) - Number(financeiro.desconto || 0)
        var todas = financeiro.parcelas || []
        // Soma "fixos": pagas + todas as que o usuário editou (incluindo a que está sendo alterada agora)
        var soma = 0
        var pendentesLivres = []
        todas.forEach(function(p) {
          var ed = next[p.id]
          var valorAtual = ed && ed.valor !== undefined ? Number(String(ed.valor).replace(',', '.')) : Number(p.valor)
          if (isNaN(valorAtual)) valorAtual = Number(p.valor)
          if (p.status === 'Pago') {
            soma += valorAtual
          } else if (ed && ed._userFixed) {
            soma += valorAtual
          } else {
            pendentesLivres.push(p)
          }
        })
        if (pendentesLivres.length > 0) {
          var restante = Math.max(0, liq - soma)
          pendentesLivres.sort(function(a,b){ return Number(a.numero) - Number(b.numero) })
          var n = pendentesLivres.length
          var unit = Math.floor(restante * 100 / n) / 100
          var ultima = Math.round((restante - unit * (n - 1)) * 100) / 100
          for (var i = 0; i < n; i++) {
            var v = (i === n - 1 ? ultima : unit).toFixed(2)
            var pid = pendentesLivres[i].id
            var prevEd = next[pid] || {}
            // Só sobrescreve se o valor calculado for diferente do que estava no banco
            if (prevEd._userFixed) continue // segurança extra (não deveria ocorrer aqui)
            if (Math.abs(Number(v) - Number(pendentesLivres[i].valor)) < 0.005 && !next[pid]) continue
            next[pid] = { ...prevEd, valor: v, _userFixed: false }
          }
        }
      }
      return next
    })
  }

  // Remove a marca de "fixado pelo usuário" de uma parcela (volta a ser auto-ajustável)
  function liberarFixacao(id) {
    setPendingEdits(function(prev) {
      var atual = prev[id]
      if (!atual) return prev
      var copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  function pendingValor(p)  { return (pendingEdits[p.id] && pendingEdits[p.id].valor !== undefined)      ? pendingEdits[p.id].valor      : Number(p.valor).toFixed(2) }
  function pendingVenc(p)   { return (pendingEdits[p.id] && pendingEdits[p.id].vencimento !== undefined) ? pendingEdits[p.id].vencimento : (p.vencimento ? String(p.vencimento).slice(0,10) : '') }
  function pendingForma(p)  { return (pendingEdits[p.id] && pendingEdits[p.id].forma_pagamento !== undefined) ? pendingEdits[p.id].forma_pagamento : (p.forma_pagamento || '') }
  function hasPending(p)    { return !!pendingEdits[p.id] }
  var qtdPending = Object.keys(pendingEdits).length

  function descartarEdicoes() {
    setPendingEdits({})
  }

  async function salvarTodasEdicoes() {
    if (!financeiro || qtdPending === 0) return
    setSavingEdits(true)
    var erros = []
    try {
      var idsEditados = Object.keys(pendingEdits)
      for (var i = 0; i < idsEditados.length; i++) {
        var id = idsEditados[i]
        var ed = pendingEdits[id]
        var patch = { updated_at: new Date().toISOString() }
        var hasChange = false
        if (ed.valor !== undefined) {
          var nv = Number(String(ed.valor).replace(',', '.'))
          if (isNaN(nv) || nv < 0) { erros.push('parc ' + id + ': valor inválido'); continue }
          patch.valor = nv
          hasChange = true
        }
        if (ed.vencimento !== undefined && ed.vencimento) {
          patch.vencimento = ed.vencimento
          hasChange = true
        }
        if (ed.forma_pagamento !== undefined) {
          patch.forma_pagamento = ed.forma_pagamento || null
          hasChange = true
        }
        if (!hasChange) continue
        var u = await supabase.from('parcelas').update(patch).eq('id', id).select()
        if (u.error) erros.push('parc ' + id + ': ' + u.error.message)
        else if (!u.data || u.data.length === 0) erros.push('parc ' + id + ': nenhuma linha atualizada (verifique permissões RLS)')
      }

      // recarrega
      var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
      setFinanceiro(fin)
      setPendingEdits({})
      if (erros.length > 0) {
        alert('Erros ao salvar:\n\n' + erros.slice(0,5).join('\n') + (erros.length > 5 ? '\n…e mais ' + (erros.length - 5) : ''))
      }
    } catch (e) {
      alert('Erro: ' + (e.message || e))
    }
    setSavingEdits(false)
  }

  // Rebalanceia pendentes (≠ pagas, ≠ fixos) pra fechar o total da venda
  async function rebalancearComFixos(idsFixos) {
    if (!financeiro || !financeiro.id) return
    var rFin = await supabase.from('financeiro').select('valor_total, desconto').eq('id', financeiro.id).single()
    if (rFin.error) return
    var rParc = await supabase.from('parcelas').select('id, numero, valor, status').eq('financeiro_id', financeiro.id)
    if (rParc.error) return
    var liq = Number(rFin.data.valor_total) - Number(rFin.data.desconto || 0)
    var todas = rParc.data || []
    var fixos = todas.filter(function(p){ return p.status === 'Pago' || (idsFixos || []).indexOf(p.id) >= 0 })
    var somaFixos = fixos.reduce(function(s,p){ return s + Number(p.valor) }, 0)
    var pendentesOutros = todas.filter(function(p){ return p.status !== 'Pago' && (idsFixos || []).indexOf(p.id) < 0 })
    if (pendentesOutros.length === 0) return
    var restante = Math.max(0, liq - somaFixos)
    pendentesOutros.sort(function(a,b){ return Number(a.numero) - Number(b.numero) })
    var n = pendentesOutros.length
    var unit = Math.floor(restante * 100 / n) / 100
    var ultima = Math.round((restante - unit * (n - 1)) * 100) / 100
    for (var i = 0; i < n; i++) {
      var v = i === n - 1 ? ultima : unit
      await supabase.from('parcelas').update({ valor: v, updated_at: new Date().toISOString() }).eq('id', pendentesOutros[i].id)
    }
  }

  // Recalcula as outras parcelas pendentes pra fechar o total.
  // Lê tudo fresco do banco pra não usar state stale.
  async function rebalancear(parcelaEditadaId) {
    if (!financeiro || !financeiro.id) return
    // Busca dados frescos
    var rFin = await supabase.from('financeiro').select('id, valor_total, desconto').eq('id', financeiro.id).single()
    if (rFin.error) { alert('Erro ao rebalancear: ' + rFin.error.message); return }
    var rParc = await supabase.from('parcelas').select('id, numero, valor, status').eq('financeiro_id', financeiro.id)
    if (rParc.error) { alert('Erro ao rebalancear: ' + rParc.error.message); return }

    var liq = Number(rFin.data.valor_total) - Number(rFin.data.desconto || 0)
    var todas = rParc.data || []

    // Soma TODAS as parcelas que não vamos rebalancear (pagas + a editada agora)
    var fixas = todas.filter(function(p){ return p.status === 'Pago' || p.id === parcelaEditadaId })
    var somaFixas = fixas.reduce(function(s,p){ return s + Number(p.valor) }, 0)
    var pendentesOutros = todas.filter(function(p){ return p.id !== parcelaEditadaId && p.status !== 'Pago' })
    if (pendentesOutros.length === 0) return
    var restante = liq - somaFixas
    if (restante < 0) restante = 0

    pendentesOutros.sort(function(a,b){ return Number(a.numero) - Number(b.numero) })
    var n = pendentesOutros.length
    var centavos = Math.round(restante * 100)
    var unit = Math.floor(centavos / n) / 100
    var ultima = Math.round((restante - unit * (n - 1)) * 100) / 100
    var erros = 0
    for (var i = 0; i < n; i++) {
      var v = i === n - 1 ? ultima : unit
      var u = await supabase.from('parcelas').update({ valor: v, updated_at: new Date().toISOString() }).eq('id', pendentesOutros[i].id)
      if (u.error) erros++
    }
    if (erros > 0) alert('Houve ' + erros + ' erro(s) ao rebalancear parcelas.')
  }

  // ── Ajuste de datas em massa ──
  var [showAjustarDatas, setShowAjustarDatas] = useState(false)
  var [ajusteModo, setAjusteModo] = useState('dia') // 'dia' | 'redefinir'
  var [ajusteDia, setAjusteDia] = useState('10')
  var [ajusteIncluirPagas, setAjusteIncluirPagas] = useState(false)
  var [ajusteNovaPrimeira, setAjusteNovaPrimeira] = useState('')
  var [ajustando, setAjustando] = useState(false)

  async function aplicarAjusteDatas() {
    if (!financeiro) return
    setAjustando(true)
    try {
      var alvos = (financeiro.parcelas || []).filter(function(p){ return ajusteIncluirPagas || p.status !== 'Pago' })
      alvos.sort(function(a,b){ return Number(a.numero) - Number(b.numero) })
      if (!alvos.length) { alert('Nenhuma parcela elegível para ajuste.'); setAjustando(false); return }

      if (ajusteModo === 'dia') {
        var dia = parseInt(ajusteDia, 10)
        if (isNaN(dia) || dia < 1 || dia > 31) { alert('Dia inválido (1-31).'); setAjustando(false); return }
        for (var i = 0; i < alvos.length; i++) {
          var p = alvos[i]
          var d = new Date(p.vencimento + 'T00:00:00')
          var ult = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
          d.setDate(Math.min(dia, ult))
          var novaData = d.toISOString().slice(0,10)
          if (novaData !== p.vencimento) {
            await supabase.from('parcelas').update({ vencimento: novaData, updated_at: new Date().toISOString() }).eq('id', p.id)
          }
        }
      } else if (ajusteModo === 'redefinir') {
        if (!ajusteNovaPrimeira) { alert('Informe a data da primeira parcela.'); setAjustando(false); return }
        var base = new Date(ajusteNovaPrimeira + 'T00:00:00')
        var diaAlvo = base.getDate()
        for (var k = 0; k < alvos.length; k++) {
          var dx = new Date(base.getTime())
          dx.setDate(1); dx.setMonth(dx.getMonth() + k)
          var ultx = new Date(dx.getFullYear(), dx.getMonth()+1, 0).getDate()
          dx.setDate(Math.min(diaAlvo, ultx))
          var novaD = dx.toISOString().slice(0,10)
          await supabase.from('parcelas').update({ vencimento: novaD, updated_at: new Date().toISOString() }).eq('id', alvos[k].id)
        }
      }

      // recarrega
      var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
      setFinanceiro(fin)
      setShowAjustarDatas(false)
      alert('Datas ajustadas com sucesso (' + alvos.length + ' parcela(s)).')
    } catch (e) { alert('Erro: ' + (e.message || e)) }
    setAjustando(false)
  }

  // ── Editar venda ──
  var [showEditVenda, setShowEditVenda] = useState(false)
  var [cursos, setCursos] = useState([])
  var [editVendaForm, setEditVendaForm] = useState({ curso_id:'', valor_total:'', desconto:'', modalidade:'', forma_pagamento:'' })
  var [savingVenda, setSavingVenda] = useState(false)

  useEffect(function() {
    supabase.from('cursos').select('id,nome,categoria,ativo').eq('ativo', true).order('ordem').then(function(r){ setCursos(r.data || []) })
  }, [])

  function abrirEdicaoVenda() {
    if (!financeiro) return
    setEditVendaForm({
      curso_id: financeiro.curso_id || '',
      valor_total: String(financeiro.valor_total || ''),
      desconto: String(financeiro.desconto || 0),
      modalidade: financeiro.modalidade || '',
      forma_pagamento: financeiro.forma_pagamento || '',
    })
    setShowEditVenda(true)
  }

  async function salvarEdicaoVenda() {
    if (!financeiro) return
    setSavingVenda(true)
    var patch = {
      curso_id: editVendaForm.curso_id || null,
      valor_total: Number(editVendaForm.valor_total) || 0,
      desconto: Number(editVendaForm.desconto) || 0,
      modalidade: editVendaForm.modalidade || null,
      forma_pagamento: editVendaForm.forma_pagamento || null,
    }
    var r = await supabase.from('financeiro').update(patch).eq('id', financeiro.id)
    if (r.error) { setSavingVenda(false); alert('Erro: ' + r.error.message); return }
    setSavingVenda(false)
    setShowEditVenda(false)
    // Recarrega o financeiro
    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
    setFinanceiro(fin)
  }

  async function carregarComissoes(finId) {
    if (!finId) { setComissoes([]); return }
    var r = await supabase.from('comissoes').select('*, profiles:beneficiario_id(nome,role)').eq('financeiro_id', finId).order('created_at')
    setComissoes(r.data || [])
  }

  // Aplica as regras ativas do curso a esta venda via RPC do banco.
  // Toda a lógica (idempotência, cálculo retroativo, FKs, NOT NULLs)
  // fica encapsulada na função SQL `aplicar_regras_comissao`.
  async function aplicarRegras() {
    if (!financeiro) return
    setAplicandoRegras(true)
    try {
      var { data, error } = await supabase.rpc('aplicar_regras_comissao', { p_fin_id: financeiro.id })
      if (error) { alert('Erro: ' + error.message); setAplicandoRegras(false); return }
      if (!data || !data.ok) {
        alert((data && data.error) || 'Erro ao aplicar regras.')
        setAplicandoRegras(false); return
      }
      if (data.no_rules) {
        alert('Nenhuma regra ativa cadastrada para o curso desta venda.\n\nCadastre em "Comissões → Regras".')
        setAplicandoRegras(false); return
      }
      var msg = 'Regras aplicadas:\n\n'
        + '✓ ' + (data.created || 0) + ' comissão(ões) criada(s)\n'
        + '↻ ' + (data.skipped || 0) + ' já existente(s) (puladas)'
      if (data.criados_nomes && data.criados_nomes.length) {
        msg += '\n\nCriadas:\n' + data.criados_nomes.join('\n')
      }
      alert(msg)
      await carregarComissoes(financeiro.id)
    } catch (e) {
      alert('Erro: ' + (e.message || e))
    }
    setAplicandoRegras(false)
  }

  async function removerComissao(c) {
    if (!window.confirm('Remover a comissão de ' + (c.profiles && c.profiles.nome || 'beneficiário') + '?\n\nMovimentos já registrados serão perdidos.')) return
    await supabase.from('comissao_movimentos').delete().eq('comissao_id', c.id)
    var r = await supabase.from('comissoes').delete().eq('id', c.id)
    if (r.error) { alert('Erro: ' + r.error.message); return }
    await carregarComissoes(financeiro.id)
  }

  useEffect(function() { carregar() }, [])
  useEffect(function() { carregarComissoes(financeiro && financeiro.id) }, [financeiro && financeiro.id])

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

  // Mapeia billingType Asaas pra forma_pagamento legível
  function mapForma(billingType) {
    if (billingType === 'PIX') return 'PIX'
    if (billingType === 'BOLETO') return 'Boleto'
    if (billingType === 'CREDIT_CARD') return 'Cartão'
    return 'Asaas' // UNDEFINED = Cliente escolhe
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
      await supabase.from('parcelas').update({
        asaas_payment_id: cob.id,
        asaas_status: cob.status,
        asaas_invoice_url: cob.invoiceUrl,
        asaas_boleto_url: cob.bankSlipUrl,
        asaas_pix_copia_cola: pixData ? pixData.payload : null,
        forma_pagamento: mapForma(cobrancaBilling),
      }).eq('id', showCobranca.id)
      setCobrancaResult({ ...cob, pixData: pixData })
      var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
      setFinanceiro(fin || null)
    } catch(e) { setCobrancaErr(e.message || 'Erro ao emitir cobranca') }
    setCobrancaLoading(false)
  }

  // Emite cobranças no Asaas pra TODAS as parcelas pendentes que ainda não têm
  // asaas_payment_id. Usa o `cobrancaBilling` atual. Serial pra respeitar rate limit Asaas.
  async function emitirEmMassa() {
    if (!selected || !financeiro) return
    var pendentes = (financeiro.parcelas || []).filter(function(p) {
      return p.status !== 'Pago' && !p.asaas_payment_id
    })
    if (!pendentes.length) { alert('Nenhuma parcela pendente para emitir.'); return }
    pendentes.sort(function(a, b){ return (a.numero || 0) - (b.numero || 0) })

    var labelBilling = cobrancaBilling === 'UNDEFINED' ? 'Cliente escolhe' : cobrancaBilling
    var confirmar = window.confirm(
      'Emitir ' + pendentes.length + ' cobrança(s) no Asaas como ' + labelBilling + '?'
      + '\n\nO cliente será sincronizado no Asaas se ainda não estiver.'
    )
    if (!confirmar) return

    setMassLoading(true)
    setMassProgress({ atual: 0, total: pendentes.length, ok: 0, err: 0, msg: 'Sincronizando cliente...' })

    try {
      // Sync uma vez só
      var asaasId = await syncClienteAsaas(selected)
      if (!selected.asaas_customer_id && asaasId) {
        await supabase.from('clientes').update({ asaas_customer_id: asaasId }).eq('id', selected.id)
      }

      var ok = 0, err = 0
      for (var i = 0; i < pendentes.length; i++) {
        var p = pendentes[i]
        setMassProgress({ atual: i + 1, total: pendentes.length, ok: ok, err: err, msg: 'Emitindo parcela ' + p.numero + '/' + pendentes.length })
        try {
          var cob = await criarCobranca({
            asaasCustomerId: asaasId,
            valor: p.valor,
            vencimento: p.vencimento || new Date().toISOString().split('T')[0],
            descricao: 'Outliers · Parcela ' + p.numero,
            billingType: cobrancaBilling,
            parcelaId: p.id,
          })
          var pix = null
          if ((cobrancaBilling === 'PIX' || cobrancaBilling === 'UNDEFINED') && cob.id) {
            try { pix = await buscarPixQrCode(cob.id) } catch (_e) {}
          }
          await supabase.from('parcelas').update({
            asaas_payment_id: cob.id,
            asaas_status: cob.status,
            asaas_invoice_url: cob.invoiceUrl,
            asaas_boleto_url: cob.bankSlipUrl,
            asaas_pix_copia_cola: pix ? pix.payload : null,
            forma_pagamento: mapForma(cobrancaBilling),
          }).eq('id', p.id)
          ok++
        } catch (e) {
          console.error('emitir parcela', p.numero, e)
          err++
        }
      }

      setMassProgress({ atual: pendentes.length, total: pendentes.length, ok: ok, err: err, msg: 'Concluído' })

      // Atualiza dados
      var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
      setFinanceiro(fin || null)
      await carregar()
    } catch (e) {
      setMassProgress(function(prev){ return { ...(prev || {}), msg: 'Erro: ' + (e.message || 'falha ao sincronizar cliente') } })
    }
    setMassLoading(false)

    setTimeout(function(){ setMassProgress(null) }, 5000)
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
                    <div style={{ fontSize:11,color:'#7a6a4a',fontFamily:'monospace' }}>{formatTel(c.telefone) || c.email || '--'}</div>
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
              <div style={{ fontSize:12,color:'#7a6a4a',marginTop:3 }}>{selected.email} {selected.email&&selected.telefone?'·':''} {formatTel(selected.telefone)}</div>
            </div>
            <button style={S.btnGhost} onClick={function(){setSelected(null);setFinanceiro(null)}}>✕</button>
          </div>

          <div style={{ padding:24,flex:1 }}>
            {loadingDet && <div style={{ color:'#7a6a4a',fontSize:13 }}>Carregando...</div>}
            {!loadingDet && !financeiro && <div style={{ color:'#7a6a4a',fontSize:13,fontStyle:'italic' }}>Sem dados financeiros cadastrados.</div>}

            {!loadingDet && financeiro && (
              <div style={{ display:'flex',flexDirection:'column',gap:16 }}>
                {/* Resumo cards + botoes editar/excluir */}
                <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                  <button style={{ ...S.btnGhost, padding:'6px 12px', fontSize:12 }} onClick={abrirEdicaoVenda}>✎ Editar venda</button>
                  <button style={{ ...S.btnGhost, padding:'6px 12px', fontSize:12, color:'#fca5a5', borderColor:'#7f1d1d' }}
                          onClick={async function() {
                            if (!window.confirm('EXCLUIR esta venda inteira?\n\nIsso apaga: financeiro, todas parcelas e todas comissões vinculadas.\n\nNão pode ser desfeito.')) return
                            var conf = window.prompt('Tem certeza absoluta? Digite EXCLUIR para confirmar.')
                            if (conf !== 'EXCLUIR') { alert('Cancelado.'); return }
                            var r = await supabase.rpc('excluir_venda', { p_fin_id: financeiro.id })
                            if (r.error) { alert('Erro: ' + r.error.message); return }
                            if (!r.data || !r.data.ok) { alert('Erro: ' + ((r.data && r.data.error) || 'desconhecido')); return }
                            setFinanceiro(null)
                            await carregar()
                          }}>🗑️ Excluir venda</button>
                </div>
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
                {(function(){
                  var curso = cursos.find(function(x){ return x.id === financeiro.curso_id })
                  return (
                    <div style={{ ...S.card, padding:'10px 16px', display:'flex', alignItems:'center', gap:12 }}>
                      <span style={{ fontSize:11, color:'#7a6a4a', textTransform:'uppercase', letterSpacing:'.08em' }}>Curso vinculado:</span>
                      <span style={{ fontSize:13, color: curso ? '#c9a96e' : '#f87171', fontWeight:600 }}>
                        {curso ? curso.nome : '⚠️ Sem curso vinculado (necessário para aplicar regras de comissão)'}
                      </span>
                    </div>
                  )
                })()}

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
                  <div style={{ padding:'12px 18px',borderBottom:'1px solid #2a2415',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap' }}>
                    <span style={{ fontSize:13,fontWeight:600,color:'#f0ead8' }}>Parcelas</span>
                    <div style={{ display:'flex',gap:10,alignItems:'center' }}>
                      <span style={{ fontSize:11,color:'#7a6a4a' }}>{(financeiro.parcelas||[]).filter(function(p){return p.status==='Pago'}).length}/{(financeiro.parcelas||[]).length} pagas</span>
                      {qtdPending > 0 && (
                        <>
                          <button onClick={salvarTodasEdicoes} disabled={savingEdits}
                                  style={{ background:'linear-gradient(180deg,#c9a96e,#a07840)', border:'none', color:'#1a1a1a', padding:'7px 14px', fontSize:12, fontWeight:700, borderRadius:6, cursor:'pointer', fontFamily:'Inter,sans-serif' }}>
                            {savingEdits ? 'Salvando…' : '💾 Salvar ' + qtdPending + ' alteração' + (qtdPending > 1 ? 'ões' : '')}
                          </button>
                          <button onClick={descartarEdicoes} disabled={savingEdits}
                                  style={{ background:'#1c1810', border:'1px solid #7f1d1d', color:'#fca5a5', padding:'7px 12px', fontSize:11, borderRadius:6, cursor:'pointer', fontFamily:'Inter,sans-serif' }}>
                            ↶ Descartar
                          </button>
                        </>
                      )}
                      <label title="Quando ativo: ao salvar uma alteração, as outras parcelas pendentes se ajustam pra fechar o total da venda."
                             style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color: autoBalancear ? '#4ade80' : '#7a6a4a', background:'#1c1810', border:'1px solid '+(autoBalancear?'#14532d':'#2a2415'), padding:'5px 10px', borderRadius:6, cursor:'pointer' }}>
                        <input type="checkbox" checked={autoBalancear} onChange={function(e){ setAutoBalancear(e.target.checked) }} style={{ accentColor:'#c9a96e' }} />
                        🔄 Auto-balancear
                      </label>
                      <button style={{ ...S.btnGhost, padding:'6px 10px', fontSize:11 }}
                              title="Recalcula todas as parcelas pendentes pra fechar o total exato"
                              onClick={async function() {
                                if (!financeiro) return
                                var liq = Number(financeiro.valor_total) - Number(financeiro.desconto||0)
                                var pagas = (financeiro.parcelas||[]).filter(function(p){ return p.status === 'Pago' }).reduce(function(s,p){ return s + Number(p.valor) }, 0)
                                var rest = liq - pagas
                                var pendentes = (financeiro.parcelas||[]).filter(function(p){ return p.status !== 'Pago' })
                                if (!pendentes.length) { alert('Não há parcelas pendentes para redistribuir.'); return }
                                if (rest <= 0) { alert('Total já pago. Sem o que redistribuir.'); return }
                                if (!window.confirm('Redistribuir ' + fmt(rest) + ' igualmente entre as ' + pendentes.length + ' parcela(s) pendente(s)?')) return
                                pendentes.sort(function(a,b){ return Number(a.numero) - Number(b.numero) })
                                var n = pendentes.length
                                var centavos = Math.round(rest * 100)
                                var unit = Math.floor(centavos / n) / 100
                                var ultima = (centavos - Math.floor(centavos / n) * (n - 1)) / 100
                                for (var i = 0; i < n; i++) {
                                  var v = i === n - 1 ? ultima : unit
                                  await supabase.from('parcelas').update({ valor: v, updated_at: new Date().toISOString() }).eq('id', pendentes[i].id)
                                }
                                var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
                                setFinanceiro(fin)
                              }}>⚖️ Redistribuir</button>
                      <button style={{ ...S.btnGhost, padding:'6px 10px', fontSize:11 }} onClick={function(){
                        var primeira = ((financeiro.parcelas||[]).slice().sort(function(a,b){ return Number(a.numero)-Number(b.numero) })[0] || {}).vencimento || ''
                        setAjusteNovaPrimeira(primeira ? String(primeira).slice(0,10) : '')
                        setShowAjustarDatas(true)
                      }}>📅 Ajustar datas</button>
                      <button style={{ ...S.btnG, padding:'6px 10px', fontSize:11 }}
                              onClick={adicionarParcela}
                              title="Adicionar nova parcela ao final (R$ 0,00 — edite o valor depois)">
                        + Parcela
                      </button>
                      {(function(){
                        var semCobranca = (financeiro.parcelas||[]).filter(function(p){ return p.status !== 'Pago' && !p.asaas_payment_id }).length
                        if (!semCobranca) return null
                        return (
                          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                            <select value={cobrancaBilling} onChange={function(e){setCobrancaBilling(e.target.value)}}
                              style={{ ...S.inp,width:130,padding:'6px 10px',fontSize:12 }}>
                              <option value="UNDEFINED">Cliente escolhe</option>
                              <option value="PIX">PIX</option>
                              <option value="BOLETO">Boleto</option>
                              <option value="CREDIT_CARD">Cartão</option>
                            </select>
                            <button
                              style={{ ...S.btnG, padding:'6px 12px', fontSize:12, opacity: massLoading ? 0.6 : 1, cursor: massLoading ? 'wait' : 'pointer' }}
                              onClick={emitirEmMassa}
                              disabled={massLoading}
                            >{massLoading ? 'Emitindo...' : '+ Emitir ' + semCobranca + ' pendente' + (semCobranca > 1 ? 's' : '')}</button>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {massProgress && (
                    <div style={{ padding:'10px 18px',borderBottom:'1px solid #2a2415',background:'#0d0b06' }}>
                      <div style={{ display:'flex',justifyContent:'space-between',fontSize:12,color:'#c9a96e',marginBottom:6 }}>
                        <span>{massProgress.msg}</span>
                        <span style={{ fontFamily:'monospace',color:'#b8a882' }}>{massProgress.atual}/{massProgress.total}</span>
                      </div>
                      <div style={{ height:4,background:'#2a2415',borderRadius:2,overflow:'hidden' }}>
                        <div style={{
                          height:'100%',
                          width: (massProgress.total ? Math.round(massProgress.atual / massProgress.total * 100) : 0) + '%',
                          background:'linear-gradient(90deg,#c9a96e,#a07840)',
                          transition:'width .25s',
                        }} />
                      </div>
                      <div style={{ display:'flex',gap:14,marginTop:6,fontSize:11,color:'#7a6a4a' }}>
                        <span>✓ <b style={{ color:'#4ade80' }}>{massProgress.ok}</b></span>
                        <span>✕ <b style={{ color:'#fca5a5' }}>{massProgress.err}</b></span>
                      </div>
                    </div>
                  )}

                  {(financeiro.parcelas||[]).slice().sort(function(a,b){ return Number(a.numero||0) - Number(b.numero||0) }).map(function(p,i,arr) {
                    var pc = PARC_C[p.status] || PARC_C['Pendente']
                    var dias = diasAteVencer(p.vencimento)
                    var alertCor = p.status !== 'Pago' && dias !== null && dias <= 3 ? (dias < 0 ? '#f87171' : '#fbbf24') : null
                    return (
                      <div key={p.id} style={{ padding:'13px 18px',borderBottom:i<arr.length-1?'1px solid #2a2415':'none',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
                        <span style={{ fontSize:11,color:'#7a6a4a',width:22,fontFamily:'monospace' }}>{String(p.numero).padStart(2,'0')}</span>
                        <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                          <span style={{ fontSize:13,color:'#7a6a4a',marginRight:2 }}>R$</span>
                          {(function(){
                            var ed = pendingEdits[p.id]
                            var userFixed = ed && ed._userFixed
                            var autoAdjusted = ed && !ed._userFixed
                            var bg = userFixed ? '#3a2a08' : autoAdjusted ? '#0d1f12' : 'transparent'
                            var border = userFixed ? '#fbbf24' : autoAdjusted ? '#14532d' : '#2a2415'
                            return (
                              <input
                                type="number"
                                step="0.01"
                                value={pendingValor(p)}
                                onChange={function(e){ updatePending(p.id, 'valor', e.target.value) }}
                                title={userFixed ? "Você editou esta parcela (fixada). As outras pendentes se ajustam ao redor." : autoAdjusted ? "Ajustada automaticamente pelo auto-balancear." : "Editar valor da parcela"}
                                style={{ background: bg, border:'1px dashed '+border, borderRadius:6, color:'#f0ead8', padding:'4px 8px', fontSize:15, fontWeight:600, width:115, outline:'none', fontFamily:'Inter,sans-serif' }}
                              />
                            )
                          })()}
                          {pendingEdits[p.id] && pendingEdits[p.id]._userFixed && (
                            <button onClick={function(){ liberarFixacao(p.id) }}
                                    title="Remover fixação manual desta parcela (deixar auto-ajustar)"
                                    style={{ background:'transparent', border:'none', color:'#fbbf24', cursor:'pointer', fontSize:12, padding:'0 2px' }}>
                              📌
                            </button>
                          )}
                          <input
                            type="date"
                            value={pendingVenc(p)}
                            onChange={function(e){ updatePending(p.id, 'vencimento', e.target.value) }}
                            title="Editar vencimento (clique em Salvar no header para confirmar)"
                            style={{ background: hasPending(p) ? '#3a2a08' : 'transparent', border:'1px dashed '+(hasPending(p)?'#fbbf24':'#2a2415'), borderRadius:6, color: alertCor || '#7a6a4a', padding:'3px 6px', fontSize:11, fontFamily:'monospace', outline:'none' }}
                          />
                          {alertCor && <span style={{ fontSize:10, color:alertCor, fontFamily:'monospace' }}>{dias < 0 ? '('+Math.abs(dias)+'d atraso)' : '('+dias+'d)'}</span>}
                          {p.pago_em && <span style={{ fontSize:11,color:'#4ade80' }}>Pago {new Date(p.pago_em).toLocaleDateString('pt-BR')}</span>}
                        </div>
                        <select
                          value={pendingForma(p)}
                          onChange={function(e){ updatePending(p.id, 'forma_pagamento', e.target.value) }}
                          title="Forma de pagamento (clique em Salvar no header para confirmar)"
                          style={{ fontSize:11, fontWeight:600, color: pendingForma(p) ? '#c9a96e' : '#7a6a4a', background: hasPending(p) ? '#3a2a08' : '#1c1810', padding:'5px 10px', borderRadius:6, border:'1px solid '+(hasPending(p)?'#fbbf24':'#2a2415'), outline:'none', cursor:'pointer', fontFamily:'Inter,sans-serif', minWidth:110 }}>
                          <option value="">— forma —</option>
                          <option value="PIX">PIX</option>
                          <option value="Boleto">Boleto</option>
                          <option value="Cartão">Cartão</option>
                          <option value="Asaas">Asaas</option>
                          <option value="Dinheiro">Dinheiro</option>
                          <option value="Transferência">Transferência</option>
                        </select>
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
                          <button title="Excluir parcela"
                                  onClick={async function() {
                                    if (!window.confirm('Excluir a parcela ' + p.numero + ' (' + fmt(p.valor) + ')?\n\n' + (p.status === 'Pago' ? 'A parcela está PAGA — comissões liberadas serão estornadas proporcionalmente.\n\n' : '') + 'Não pode ser desfeito.')) return
                                    var r = await supabase.rpc('excluir_parcela', { p_parc_id: p.id })
                                    if (r.error) { alert('Erro: ' + r.error.message); return }
                                    if (!r.data || !r.data.ok) { alert('Erro: ' + ((r.data && r.data.error) || 'desconhecido')); return }
                                    var { data: fin } = await supabase.from('financeiro').select('*, parcelas(*)').eq('cliente_id', selected.id).maybeSingle()
                                    setFinanceiro(fin)
                                  }}
                                  style={{ background:'#1c1810',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'4px 8px',borderRadius:6,fontSize:11,cursor:'pointer',fontFamily:'Inter,sans-serif' }}>
                            🗑️
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Contrato (ZapSign) */}
                <div style={S.card}>
                  <div style={{ padding:'12px 18px',borderBottom:'1px solid #2a2415',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap' }}>
                    <span style={{ fontSize:13,fontWeight:600,color:'#f0ead8' }}>
                      📝 Contrato {contratos.length > 0 && <span style={{ color:'#7a6a4a',fontWeight:400 }}>({contratos.length})</span>}
                    </span>
                    <button style={{ ...S.btnG, padding:'6px 12px', fontSize:12 }} onClick={abrirEnvioContrato}>+ Enviar contrato</button>
                  </div>
                  {contratos.length === 0 ? (
                    <div style={{ padding:'18px',textAlign:'center',color:'#7a6a4a',fontSize:12,fontStyle:'italic' }}>
                      Nenhum contrato enviado. Clique em "Enviar contrato" pra anexar o PDF e mandar pra assinatura via ZapSign.
                    </div>
                  ) : contratos.map(function(c, i, arr) {
                    var corStatus = c.status === 'Assinado' ? '#4ade80'
                                   : c.status === 'Recusado' || c.status === 'Cancelado' ? '#fca5a5'
                                   : '#fbbf24'
                    return (
                      <div key={c.id} style={{ padding:'12px 18px',borderBottom: i<arr.length-1 ? '1px solid #2a2415' : 'none', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                        <div style={{ flex:'1 1 220px', minWidth:200 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'#f0ead8' }}>{c.signer_nome || '—'}</div>
                          <div style={{ fontSize:11, color:'#7a6a4a', marginTop:2 }}>{c.signer_email || '—'}</div>
                          {c.enviado_em && <div style={{ fontSize:10, color:'#7a6a4a', marginTop:1 }}>Enviado em {new Date(c.enviado_em).toLocaleDateString('pt-BR')}</div>}
                          {c.assinado_at && <div style={{ fontSize:10, color:'#4ade80', marginTop:1 }}>Assinado em {new Date(c.assinado_at).toLocaleDateString('pt-BR')}</div>}
                        </div>
                        <span style={{ background:corStatus+'22', border:'1px solid '+corStatus, color:corStatus, padding:'3px 9px', borderRadius:9999, fontSize:11, fontWeight:600 }}>{c.status || 'Aguardando'}</span>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          {c.link_assinatura && (
                            <button onClick={function(){ reenviarLink(c) }}
                                    style={{ background:'#1c1810', border:'1px solid #2a2415', color:'#c9a96e', padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', fontFamily:'Inter,sans-serif' }}
                                    title="Copiar link de assinatura">🔗 Copiar link</button>
                          )}
                          {c.pdf_assinado_url && (
                            <a href={c.pdf_assinado_url} target="_blank" rel="noreferrer"
                               style={{ background:'#14532d22', border:'1px solid #14532d', color:'#4ade80', padding:'5px 10px', borderRadius:6, fontSize:11, textDecoration:'none', fontFamily:'Inter,sans-serif' }}>
                              📄 PDF assinado
                            </a>
                          )}
                          {c.pdf_original_url && !c.pdf_assinado_url && (
                            <a href={c.pdf_original_url} target="_blank" rel="noreferrer"
                               style={{ background:'#1c1810', border:'1px solid #2a2415', color:'#a08658', padding:'5px 10px', borderRadius:6, fontSize:11, textDecoration:'none', fontFamily:'Inter,sans-serif' }}>
                              📄 PDF original
                            </a>
                          )}
                          <button onClick={function(){ excluirContrato(c) }}
                                  style={{ background:'#1c1810', border:'1px solid #7f1d1d', color:'#fca5a5', padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', fontFamily:'Inter,sans-serif' }}
                                  title="Remover registro">🗑️</button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Comissionados */}
                <div style={S.card}>
                  <div style={{ padding:'12px 18px',borderBottom:'1px solid #2a2415',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap' }}>
                    <span style={{ fontSize:13,fontWeight:600,color:'#f0ead8' }}>
                      Comissionados {comissoes.length > 0 && <span style={{ color:'#7a6a4a',fontWeight:400 }}>({comissoes.length})</span>}
                    </span>
                    <button style={{ ...S.btnG, padding:'6px 12px', fontSize:12, opacity: aplicandoRegras ? 0.6 : 1 }}
                            onClick={aplicarRegras} disabled={aplicandoRegras}
                            title="Aplica as regras cadastradas em Comissões → Regras para o curso desta venda">
                      {aplicandoRegras ? 'Aplicando…' : '🔄 Aplicar regras'}
                    </button>
                  </div>

                  {comissoes.length === 0 ? (
                    <div style={{ padding:'18px',textAlign:'center',color:'#7a6a4a',fontSize:12,fontStyle:'italic' }}>
                      Nenhuma comissão atrelada a esta venda. Cadastre regras em <strong>Comissões → Regras</strong> e clique em "Aplicar regras".
                    </div>
                  ) : comissoes.map(function(c, i, arr) {
                    var aPagar = Number(c.valor_liberado||0) - Number(c.valor_pago||0)
                    var corPapel = c.papel === 'comercial' ? '#c9a96e'
                                 : c.papel === 'marketing' ? '#a78bfa'
                                 : c.papel === 'financeiro' ? '#4ade80'
                                 : c.papel === 'operacional' ? '#60a5fa' : '#7a6a4a'
                    return (
                      <div key={c.id} style={{ padding:'12px 18px',borderBottom:i<arr.length-1?'1px solid #2a2415':'none',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap' }}>
                        <div style={{ flex:'1 1 180px',minWidth:160 }}>
                          <div style={{ fontSize:13,fontWeight:600,color:'#f0ead8' }}>{c.profiles && c.profiles.nome || '—'}</div>
                          <div style={{ fontSize:10,color:corPapel,textTransform:'uppercase',letterSpacing:'.08em',marginTop:2,fontWeight:600 }}>
                            {c.papel} · {Number(c.percentual).toFixed(2)}%
                          </div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em' }}>Total</div>
                          <div style={{ fontSize:14,fontWeight:600,color:'#f0ead8' }}>{fmt(c.valor_total)}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em' }}>Liberado</div>
                          <div style={{ fontSize:14,fontWeight:600,color:'#4ade80' }}>{fmt(c.valor_liberado)}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:10,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em' }}>A pagar</div>
                          <div style={{ fontSize:14,fontWeight:600,color: aPagar > 0 ? '#c9a96e' : '#7a6a4a' }}>{fmt(aPagar)}</div>
                        </div>
                        <button onClick={function(){ removerComissao(c) }}
                                title="Remover comissão"
                                style={{ background:'#1c1810',border:'1px solid #7f1d1d',color:'#fca5a5',padding:'5px 10px',borderRadius:6,cursor:'pointer',fontSize:11,fontFamily:'Inter,sans-serif' }}>
                          Remover
                        </button>
                      </div>
                    )
                  })}

                  <div style={{ padding:'10px 18px',background:'#0d0b06',fontSize:11,color:'#7a6a4a',borderTop:'1px solid #2a2415' }}>
                    💡 Comissões são geradas a partir das <strong style={{ color:'#a08658' }}>regras cadastradas</strong> em "Comissões → Regras" (curso × beneficiário × papel × %). Vendas novas geram automaticamente. Para vendas antigas, clique em <strong style={{ color:'#a08658' }}>"Aplicar regras"</strong>. Parcelas pagas liberam comissão proporcional; parcelas futuras liberam automaticamente quando o cliente pagar.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Enviar Contrato (ZapSign) */}
      {showEnviarContrato && financeiro && (
        <div onClick={function(){ if(!enviandoContrato) setShowEnviarContrato(false) }} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209',border:'1px solid #2a2415',borderRadius:12,padding:24,width:540,maxWidth:'92vw' }}>
            <div style={{ display:'flex',justifyContent:'space-between',marginBottom:18 }}>
              <div style={{ fontSize:14,fontWeight:600,color:'#c9a96e',textTransform:'uppercase',letterSpacing:'.08em' }}>📝 Enviar contrato — ZapSign</div>
              <button onClick={function(){ if(!enviandoContrato) setShowEnviarContrato(false) }} style={{ background:'none',border:'none',color:'#7a6a4a',fontSize:20,cursor:'pointer' }}>×</button>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Nome do documento</label>
              <input style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }}
                     value={contratoForm.doc_name} onChange={function(e){ setContratoForm(function(p){ return { ...p, doc_name: e.target.value } }) }} />
            </div>

            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14 }}>
              <div>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Nome do signatário</label>
                <input style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }}
                       value={contratoForm.signer_nome} onChange={function(e){ setContratoForm(function(p){ return { ...p, signer_nome: e.target.value } }) }} />
              </div>
              <div>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>E-mail (receberá o link)</label>
                <input type="email" style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }}
                       value={contratoForm.signer_email} onChange={function(e){ setContratoForm(function(p){ return { ...p, signer_email: e.target.value } }) }} />
              </div>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Arquivo PDF do contrato (máx. 9MB)</label>
              <input type="file" accept=".pdf,application/pdf" onChange={handleArquivoContrato}
                     style={{ width:'100%',background:'#0a0900',border:'1px dashed #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }} />
              {contratoForm.pdf_filename && (
                <div style={{ fontSize:11, color:'#4ade80', marginTop:6 }}>✓ {contratoForm.pdf_filename}</div>
              )}
            </div>

            <div style={{ fontSize:11, color:'#7a6a4a', marginBottom:14, padding:10, background:'#0a0900', borderRadius:6, border:'1px solid #2a2415' }}>
              ℹ️ O ZapSign enviará o e-mail com o link de assinatura automaticamente. Quando o cliente assinar, o PDF assinado aparecerá automaticamente aqui (via webhook).
            </div>

            <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
              <button style={{ background:'#1c1810',border:'1px solid #2a2415',color:'#a08658',padding:'8px 14px',borderRadius:6,fontSize:13,fontFamily:'Inter,sans-serif',cursor:'pointer' }}
                      onClick={function(){ setShowEnviarContrato(false) }} disabled={enviandoContrato}>Cancelar</button>
              <button style={{ ...S.btnG, padding:'8px 16px' }} onClick={enviarContrato} disabled={enviandoContrato}>
                {enviandoContrato ? 'Enviando…' : 'Enviar via ZapSign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Ajustar Datas em Massa */}
      {showAjustarDatas && financeiro && (
        <div onClick={function(){ if(!ajustando) setShowAjustarDatas(false) }} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209',border:'1px solid #2a2415',borderRadius:12,padding:24,width:480,maxWidth:'92vw' }}>
            <div style={{ display:'flex',justifyContent:'space-between',marginBottom:18 }}>
              <div style={{ fontSize:14,fontWeight:600,color:'#c9a96e',textTransform:'uppercase',letterSpacing:'.08em' }}>📅 Ajustar datas das parcelas</div>
              <button onClick={function(){ if(!ajustando) setShowAjustarDatas(false) }} style={{ background:'none',border:'none',color:'#7a6a4a',fontSize:20,cursor:'pointer' }}>×</button>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:ajusteModo==='dia'?'#1c1810':'#0a0900',border:'1px solid '+(ajusteModo==='dia'?'#c9a96e':'#2a2415'),borderRadius:8,cursor:'pointer',marginBottom:8 }}>
                <input type="radio" name="modo" checked={ajusteModo==='dia'} onChange={function(){ setAjusteModo('dia') }} />
                <div>
                  <div style={{ fontSize:13,color:'#f0ead8',fontWeight:500 }}>Mudar o dia do mês</div>
                  <div style={{ fontSize:11,color:'#7a6a4a' }}>Mantém o mês de cada parcela, troca só o dia. Ex: todas para dia 10.</div>
                </div>
              </label>
              <label style={{ display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:ajusteModo==='redefinir'?'#1c1810':'#0a0900',border:'1px solid '+(ajusteModo==='redefinir'?'#c9a96e':'#2a2415'),borderRadius:8,cursor:'pointer' }}>
                <input type="radio" name="modo" checked={ajusteModo==='redefinir'} onChange={function(){ setAjusteModo('redefinir') }} />
                <div>
                  <div style={{ fontSize:13,color:'#f0ead8',fontWeight:500 }}>Redefinir a partir de uma nova primeira data</div>
                  <div style={{ fontSize:11,color:'#7a6a4a' }}>Define a data da primeira parcela e recalcula as demais (mensalmente).</div>
                </div>
              </label>
            </div>

            {ajusteModo === 'dia' && (
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Dia do vencimento (1-31)</label>
                <input type="number" min="1" max="31" value={ajusteDia} onChange={function(e){ setAjusteDia(e.target.value) }}
                       style={{ width:120,background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:14,fontFamily:'Inter,sans-serif',outline:'none' }} />
              </div>
            )}

            {ajusteModo === 'redefinir' && (
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Data da primeira parcela</label>
                <input type="date" value={ajusteNovaPrimeira} onChange={function(e){ setAjusteNovaPrimeira(e.target.value) }}
                       style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:14,fontFamily:'Inter,sans-serif',outline:'none' }} />
              </div>
            )}

            <label style={{ display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#7a6a4a',marginBottom:14 }}>
              <input type="checkbox" checked={ajusteIncluirPagas} onChange={function(e){ setAjusteIncluirPagas(e.target.checked) }} />
              Aplicar também em parcelas já pagas (use com cuidado)
            </label>

            <div style={{ fontSize:11, color:'#7a6a4a', marginBottom:14, padding:10, background:'#0a0900', borderRadius:6, border:'1px solid #2a2415' }}>
              ℹ️ Por padrão, parcelas já pagas não são alteradas. A entrada também é considerada uma parcela e pode ser ajustada se ainda estiver pendente.
            </div>

            <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
              <button style={{ background:'#1c1810',border:'1px solid #2a2415',color:'#a08658',padding:'8px 14px',borderRadius:6,fontSize:13,fontFamily:'Inter,sans-serif',cursor:'pointer' }}
                      onClick={function(){ setShowAjustarDatas(false) }} disabled={ajustando}>Cancelar</button>
              <button style={{ ...S.btnG, padding:'8px 16px' }} onClick={aplicarAjusteDatas} disabled={ajustando}>
                {ajustando ? 'Aplicando…' : 'Aplicar ajuste'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Editar Venda */}
      {showEditVenda && financeiro && (
        <div onClick={function(){ if(!savingVenda) setShowEditVenda(false) }} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div onClick={function(e){ e.stopPropagation() }} style={{ background:'#141209',border:'1px solid #2a2415',borderRadius:12,padding:24,width:520,maxWidth:'92vw' }}>
            <div style={{ display:'flex',justifyContent:'space-between',marginBottom:18 }}>
              <div style={{ fontSize:14,fontWeight:600,color:'#c9a96e',textTransform:'uppercase',letterSpacing:'.08em' }}>Editar venda</div>
              <button onClick={function(){ if(!savingVenda) setShowEditVenda(false) }} style={{ background:'none',border:'none',color:'#7a6a4a',fontSize:20,cursor:'pointer' }}>×</button>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Curso vendido</label>
              <select value={editVendaForm.curso_id} onChange={function(e){ setEditVendaForm(function(p){ return { ...p, curso_id: e.target.value } }) }}
                      style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }}>
                <option value="">— Sem curso vinculado —</option>
                {cursos.map(function(c){ return <option key={c.id} value={c.id}>{c.nome} {c.categoria ? '('+c.categoria+')' : ''}</option> })}
              </select>
            </div>

            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14 }}>
              <div>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Valor total (R$)</label>
                <input type="number" step="0.01" value={editVendaForm.valor_total}
                       onChange={function(e){ setEditVendaForm(function(p){ return { ...p, valor_total: e.target.value } }) }}
                       style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }} />
              </div>
              <div>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Desconto (R$)</label>
                <input type="number" step="0.01" value={editVendaForm.desconto}
                       onChange={function(e){ setEditVendaForm(function(p){ return { ...p, desconto: e.target.value } }) }}
                       style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }} />
              </div>
            </div>

            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14 }}>
              <div>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Modalidade</label>
                <select value={editVendaForm.modalidade} onChange={function(e){ setEditVendaForm(function(p){ return { ...p, modalidade: e.target.value } }) }}
                        style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }}>
                  <option value="">—</option>
                  <option value="A Vista">À Vista</option>
                  <option value="Parcelado">Parcelado</option>
                </select>
              </div>
              <div>
                <label style={{ display:'block',fontSize:11,color:'#7a6a4a',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6 }}>Forma de pagamento</label>
                <select value={editVendaForm.forma_pagamento} onChange={function(e){ setEditVendaForm(function(p){ return { ...p, forma_pagamento: e.target.value } }) }}
                        style={{ width:'100%',background:'#0a0900',border:'1px solid #2a2415',borderRadius:6,padding:'10px 12px',color:'#f0ead8',fontSize:13,fontFamily:'Inter,sans-serif',outline:'none' }}>
                  <option value="">—</option>
                  <option value="PIX">PIX</option>
                  <option value="Boleto">Boleto</option>
                  <option value="Cartao">Cartão</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
            </div>

            <div style={{ fontSize:11, color:'#7a6a4a', marginBottom:14, padding:10, background:'#0a0900', borderRadius:6, border:'1px solid #2a2415' }}>
              ⚠️ Editar valor total não recalcula as parcelas existentes — ajuste-as manualmente se necessário. Mudar o curso depois pode exigir reaplicar regras de comissão.
            </div>

            <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
              <button style={{ background:'#1c1810',border:'1px solid #2a2415',color:'#a08658',padding:'8px 14px',borderRadius:6,fontSize:13,fontFamily:'Inter,sans-serif',cursor:'pointer' }}
                      onClick={function(){ setShowEditVenda(false) }} disabled={savingVenda}>Cancelar</button>
              <button style={{ ...S.btnG, padding:'8px 16px' }}
                      onClick={salvarEdicaoVenda} disabled={savingVenda}>
                {savingVenda ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
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
