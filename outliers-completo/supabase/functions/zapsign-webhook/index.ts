// supabase/functions/zapsign-webhook/index.ts
//
// Recebe webhooks do ZapSign. Quando um contrato é assinado:
//   1. Atualiza status do contrato existente (se cadastrado via CRM)
//   2. Cria/atualiza cliente no CRM automaticamente com dados do signer
//   3. Se não existia contrato registrado (assinatura externa ao CRM),
//      cria o registro do contrato + cliente baseado nos dados do signer
//   4. Cria notificação para o admin
//
// Eventos suportados: doc_signed, doc_partially_signed, doc_refused, doc_deleted

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function onlyDigits(s: string | undefined | null): string {
  return (s || '').replace(/\D/g, '')
}

function pickSigner(body: any): any {
  // ZapSign pode mandar 1 ou mais signers. Pegamos o primeiro com status 'signed'
  // ou o primeiro mesmo se nenhum estiver explicitamente signed.
  const signers = Array.isArray(body?.signers) ? body.signers : []
  return signers.find((s: any) => s?.status === 'signed') || signers[0] || null
}

// Detecta se o contrato é de Storydoing pelo nome ou external_id
function ehStorydoing(docName: string | null | undefined, externalId: string | null | undefined): boolean {
  const n = (docName || '').toLowerCase()
  const e = (externalId || '').toLowerCase()
  if (e.startsWith('sd-') || e.startsWith('storydoing')) return true
  if (n.includes('storydoing')) return true
  if (n.includes('locação') || n.includes('locacao')) return true
  if (n.includes('sala black') || n.includes('sala white')) return true
  return false
}

// Extrai a sala (black/white) do nome do documento
function extrairSala(docName: string | null | undefined): string | null {
  const n = (docName || '').toLowerCase()
  if (n.includes('black')) return 'black'
  if (n.includes('white')) return 'white'
  return null
}

// Lê variáveis do template a partir do array de answers do ZapSign.
// answers[] tem itens com { variable, answer } (case-insensitive).
function lerAnswer(answers: any[], ...labels: string[]): string {
  if (!Array.isArray(answers)) return ''
  const norm = (s: string) => (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
  for (const lbl of labels) {
    const alvo = norm(lbl)
    const hit = answers.find((a: any) => {
      const v = norm(a?.variable || a?.label || a?.name || '')
      return v === alvo || v.includes(alvo)
    })
    if (hit) {
      const val = (hit.answer || hit.value || '').toString().trim()
      if (val) return val
    }
  }
  return ''
}

// Parse de número monetário em português ("R$ 1.234,56" → 1234.56)
function parseValorBR(s: string | undefined | null): number {
  if (!s) return 0
  const limpo = s.toString().replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.')
  const v = parseFloat(limpo)
  return isNaN(v) ? 0 : v
}

// Parse de horário em texto livre tipo "13hs ás 16hs" / "13h as 16h" / "13:00 as 16:30"
// Retorna { inicio: "HH:MM:SS" | null, fim: "HH:MM:SS" | null }
function parseHorario(s: string | undefined | null): { inicio: string | null, fim: string | null } {
  if (!s) return { inicio: null, fim: null }
  const txt = s.toString().toLowerCase()
  // Pega todas as ocorrências de número (com ou sem :minutos)
  const re = /(\d{1,2})(?:[:h](\d{2}))?/g
  const matches: Array<{ h: number, m: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(txt)) !== null) {
    const h = parseInt(m[1], 10)
    const min = m[2] ? parseInt(m[2], 10) : 0
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      matches.push({ h, m: min })
    }
  }
  const fmt = (x: { h: number, m: number }) =>
    `${String(x.h).padStart(2, '0')}:${String(x.m).padStart(2, '0')}:00`
  return {
    inicio: matches[0] ? fmt(matches[0]) : null,
    fim: matches[1] ? fmt(matches[1]) : null,
  }
}

async function upsertCliente(supabase: any, signer: any, docName: string | null): Promise<string | null> {
  if (!signer) return null
  const nome = (signer.name || '').trim()
  const email = (signer.email || '').trim().toLowerCase()
  const tel = onlyDigits(signer.phone_number)
  const cpf = onlyDigits(signer.documentation || signer.documento || '')

  if (!nome && !email && !cpf) return null  // nada utilizável

  // Procura cliente existente por email -> cpf -> telefone
  let clienteId: string | null = null
  if (email) {
    const r = await supabase.from('clientes').select('id').ilike('email', email).maybeSingle()
    if (r.data) clienteId = r.data.id
  }
  if (!clienteId && cpf) {
    const r = await supabase.from('clientes').select('id').eq('cpf', cpf).maybeSingle()
    if (r.data) clienteId = r.data.id
  }
  if (!clienteId && tel) {
    const r = await supabase.from('clientes').select('id').eq('telefone', tel).maybeSingle()
    if (r.data) clienteId = r.data.id
  }

  if (clienteId) {
    const r = await supabase.from('clientes').select('email,telefone,cpf,nome').eq('id', clienteId).single()
    const atual = r.data || {}
    const patch: Record<string, any> = {}
    if (!atual.email && email) patch.email = email
    if (!atual.telefone && tel) patch.telefone = tel
    if (!atual.cpf && cpf) patch.cpf = cpf
    if (!atual.nome && nome) patch.nome = nome
    if (Object.keys(patch).length) {
      await supabase.from('clientes').update(patch).eq('id', clienteId)
    }
    return clienteId
  }

  // Cria novo cliente (origem Storydoing)
  const { data: novo, error } = await supabase.from('clientes').insert({
    nome: nome || 'Cliente ZapSign',
    email: email || null,
    telefone: tel || null,
    cpf: cpf || null,
    origem: 'Storydoing',
    programa: 'Storydoing',
    status: 'Ativo',
    stage: 'Ganho',
    data_entrada: new Date().toISOString().slice(0, 10),
    observacoes: docName ? `Importado via contrato Storydoing assinado: ${docName}` : 'Importado via contrato Storydoing assinado',
  }).select().single()

  if (error) {
    console.error('[zapsign] erro ao criar cliente:', error)
    return null
  }
  return novo.id
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Auth opcional via query token
  const expectedToken = Deno.env.get('ZAPSIGN_WEBHOOK_TOKEN') ?? ''
  if (expectedToken) {
    const u = new URL(req.url)
    const got = u.searchParams.get('token') || req.headers.get('x-webhook-token') || ''
    if (got !== expectedToken) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 })
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  let body: any
  try { body = await req.json() } catch { return new Response('invalid json', { status: 400 }) }

  const event = (body?.event_type || body?.event || '') as string
  const docToken = body?.token as string | undefined
  const externalId = body?.external_id as string | undefined
  const docName = body?.name as string | undefined
  const status = body?.status as string | undefined
  const signedFile = body?.signed_file as string | undefined
  const originalFile = body?.original_file as string | undefined
  const signer = pickSigner(body)

  // Identifica contrato existente (se houver)
  let contrato: any = null
  if (docToken) {
    const r = await supabase.from('contratos')
      .select('id, financeiro_id, cliente_id, status, pdf_original_url')
      .eq('zapsign_doc_token', docToken).maybeSingle()
    contrato = r.data || null
  }
  if (!contrato && externalId && externalId.startsWith('fin-')) {
    const r = await supabase.from('contratos')
      .select('id, financeiro_id, cliente_id, status, pdf_original_url')
      .eq('financeiro_id', externalId.slice(4)).maybeSingle()
    contrato = r.data || null
  }

  // Filtro: só processa contratos Storydoing (por enquanto)
  // Contratos já registrados no CRM (via fluxo interno) continuam sendo processados normalmente.
  const isStorydoing = ehStorydoing(docName, externalId)
  if (!contrato && !isStorydoing) {
    return new Response(JSON.stringify({
      ok: true,
      skipped: 'not-storydoing',
      doc: docName,
    }), { status: 200 })
  }

  // Determina o novo status
  let novoStatus: string | null = null
  if (event === 'doc_signed' || status === 'signed') novoStatus = 'Assinado'
  else if (event === 'doc_refused' || status === 'refused') novoStatus = 'Recusado'
  else if (event === 'doc_partially_signed' || status === 'partially_signed') novoStatus = 'Assinado parcialmente'
  else if (event === 'doc_deleted' || status === 'deleted') novoStatus = 'Cancelado'

  // === ASSINADO: cria/atualiza cliente automaticamente ===
  let clienteId: string | null = contrato?.cliente_id || null
  if (novoStatus === 'Assinado' && signer) {
    const novoCli = await upsertCliente(supabase, signer, docName || null)
    if (novoCli) clienteId = novoCli
  }

  // === Atualiza ou cria registro de contrato ===
  if (contrato) {
    const patch: Record<string, unknown> = { payload_zapsign: body, updated_at: new Date().toISOString() }
    if (originalFile && !contrato.pdf_original_url) patch.pdf_original_url = originalFile
    if (novoStatus) patch.status = novoStatus
    if (novoStatus === 'Assinado') {
      patch.assinado = true
      patch.assinado_at = new Date().toISOString()
      if (signedFile) patch.pdf_assinado_url = signedFile
      if (clienteId && !contrato.cliente_id) patch.cliente_id = clienteId
    } else if (novoStatus === 'Recusado') {
      patch.recusado_em = new Date().toISOString()
    }
    await supabase.from('contratos').update(patch).eq('id', contrato.id)
  } else if (novoStatus === 'Assinado' && clienteId) {
    // Contrato não estava cadastrado (assinatura externa) → cria registro
    const { data: novoContrato } = await supabase.from('contratos').insert({
      cliente_id: clienteId,
      zapsign_doc_id: body?.open_id?.toString() || null,
      zapsign_doc_token: docToken || null,
      pdf_original_url: originalFile || null,
      pdf_assinado_url: signedFile || null,
      signer_nome: signer?.name || null,
      signer_email: signer?.email || null,
      status: 'Assinado',
      assinado: true,
      assinado_at: new Date().toISOString(),
      enviado_em: new Date().toISOString(),
      texto_contrato: docName || null,
      payload_zapsign: body,
    }).select().single()
    contrato = novoContrato
  }

  // === STORYDOING: cria locação automaticamente se for contrato de sala ===
  let locacaoId: string | null = null
  if (novoStatus === 'Assinado' && isStorydoing && clienteId) {
    const sala = extrairSala(docName)
    if (sala) {
      // Verifica se já existe locação vinculada a este cliente + doc_token (evita duplicar reenvios do webhook)
      let jaExiste = false
      if (docToken) {
        const r = await supabase.from('storydoing_locacoes')
          .select('id').eq('zapsign_doc_token', docToken).maybeSingle()
        if (r.data?.id) {
          locacaoId = r.data.id
          jaExiste = true
        }
      }

      if (!jaExiste) {
        const answers = Array.isArray(body?.answers) ? body.answers : []

        // === Variáveis do template SALA BLACK (nomes exatos) ===
        const nomeEmpresa = lerAnswer(answers, 'NOME DA EMPRESA', 'EMPRESA', 'RAZAO SOCIAL', 'RAZÃO SOCIAL')
        const nomeResp = lerAnswer(answers, 'NOME DO RESPONSAVEL', 'NOME DO RESPONSÁVEL', 'RESPONSAVEL', 'RESPONSÁVEL', 'NOME')
        const whats = lerAnswer(answers, 'WHATSAPP COM DDD', 'WHATSAPP', 'TELEFONE', 'CELULAR')
        const emailAns = lerAnswer(answers, 'E-MAIL', 'EMAIL', 'E MAIL')
        const cnpj = lerAnswer(answers, 'CNPJ')
        const cpfResp = lerAnswer(answers, 'CPF DO RESPONSAVEL', 'CPF DO RESPONSÁVEL', 'CPF')
        const endereco = lerAnswer(answers, 'ENDERECO COMPLETO', 'ENDEREÇO COMPLETO', 'ENDERECO', 'ENDEREÇO')
        const valorAns = lerAnswer(answers, 'VALOR TOTAL DA LOCACAO', 'VALOR TOTAL DA LOCAÇÃO', 'VALOR DA LOCAÇÃO', 'VALOR DA LOCACAO', 'VALOR TOTAL', 'VALOR')
        const formaPag = lerAnswer(answers, 'FORMA DE PAGAMENTO', 'PAGAMENTO', 'FORMA PAGAMENTO')
        const dataLoc = lerAnswer(answers, 'DATA DO EVENTO', 'DATA DA LOCACAO', 'DATA DA LOCAÇÃO', 'DATA INICIAL', 'DATA INICIO', 'DATA INÍCIO', 'DATA')
        const dataFim = lerAnswer(answers, 'DATA FIM', 'DATA FINAL', 'DATA TERMINO', 'DATA TÉRMINO')
        const horarioEvento = lerAnswer(answers, 'HORARIO DO EVENTO', 'HORÁRIO DO EVENTO', 'HORARIO', 'HORÁRIO')
        const horaIni = lerAnswer(answers, 'HORA INICIO', 'HORA INÍCIO', 'HORARIO INICIO', 'HORÁRIO INÍCIO')
        const horaFim = lerAnswer(answers, 'HORA FIM', 'HORARIO FIM', 'HORÁRIO FIM')
        const nomeEvento = lerAnswer(answers, 'NOME DO EVENTO', 'EVENTO')
        const qtdPessoas = lerAnswer(answers, 'QUANTIDADE DE PESSOAS', 'QTD PESSOAS', 'PESSOAS')
        const formato = lerAnswer(answers, 'FORMATO AUDITORIO CADEIRAS OU ESCOLAR COM MESA', 'FORMATO')
        const tempoPodcast = lerAnswer(answers, 'TEMPO PODCAST EM HORAS', 'TEMPO PODCAST', 'PODCAST')

        const locadorNome = nomeEmpresa || nomeResp || signer?.name || 'Locador'
        const locadorTel = onlyDigits(whats || signer?.phone_number || '')
        const locadorEmail = (emailAns || signer?.email || '').toLowerCase()
        const locadorDoc = onlyDigits(cnpj || cpfResp || signer?.documentation || '')
        const valor = parseValorBR(valorAns)

        // Parse de horário (vem como texto livre tipo "13hs ás 16hs")
        const { inicio: horaIniParsed, fim: horaFimParsed } = parseHorario(horarioEvento)

        const obsParts: string[] = []
        if (docName) obsParts.push(`Contrato ZapSign: ${docName}`)
        if (nomeEvento) obsParts.push(`Evento: ${nomeEvento}`)
        if (qtdPessoas) obsParts.push(`Pessoas: ${qtdPessoas}`)
        if (formato) obsParts.push(`Formato: ${formato}`)
        if (tempoPodcast && tempoPodcast.toUpperCase() !== 'N/A') obsParts.push(`Podcast: ${tempoPodcast}h`)
        if (endereco) obsParts.push(`Endereço: ${endereco}`)
        if (nomeResp && nomeEmpresa) obsParts.push(`Responsável: ${nomeResp}`)
        if (cnpj && cpfResp) obsParts.push(`CNPJ ${cnpj} • CPF resp. ${cpfResp}`)
        if (!valorAns) obsParts.push('⚠ Valor não veio do contrato — preencher manualmente')
        if (!formaPag) obsParts.push('⚠ Forma de pagamento não veio do contrato — preencher manualmente')

        const insertLoc: Record<string, any> = {
          sala,
          data_locacao: new Date().toISOString().slice(0, 10), // fallback hoje, sobrescreve abaixo se vier no contrato
          valor,
          locador_nome: locadorNome,
          locador_telefone: locadorTel || null,
          locador_email: locadorEmail || null,
          locador_documento: locadorDoc || null,
          observacoes: obsParts.join(' • ') || null,
          status_pagamento: 'Pendente',
          cliente_id: clienteId,
          zapsign_doc_token: docToken || null,
        }
        // Tenta parsear datas BR (dd/mm/yyyy)
        const tryDate = (s: string): string | null => {
          if (!s) return null
          const m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/)
          if (m) {
            const d = m[1].padStart(2, '0')
            const mo = m[2].padStart(2, '0')
            let y = m[3]
            if (y.length === 2) y = '20' + y
            return `${y}-${mo}-${d}`
          }
          // ISO?
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
          return null
        }
        if (dataLoc) insertLoc.data_locacao = tryDate(dataLoc) || insertLoc.data_locacao
        if (dataFim) insertLoc.data_fim = tryDate(dataFim)
        // Horários: primeiro tenta campos separados, senão parseia "HORÁRIO DO EVENTO"
        if (horaIni) insertLoc.hora_inicio = horaIni
        else if (horaIniParsed) insertLoc.hora_inicio = horaIniParsed
        if (horaFim) insertLoc.hora_fim = horaFim
        else if (horaFimParsed) insertLoc.hora_fim = horaFimParsed
        if (formaPag) insertLoc.forma_pagamento = formaPag

        const { data: novaLoc, error: errLoc } = await supabase
          .from('storydoing_locacoes')
          .insert(insertLoc)
          .select()
          .single()

        if (errLoc) {
          console.error('[zapsign] erro ao criar locação storydoing:', errLoc)
        } else {
          locacaoId = novaLoc?.id || null
        }
      }
    }
  }

  // Notifica admin se foi assinado
  if (novoStatus === 'Assinado' && clienteId) {
    let clienteNome = signer?.name || ''
    if (!clienteNome) {
      const r = await supabase.from('clientes').select('nome').eq('id', clienteId).maybeSingle()
      clienteNome = r.data?.nome || 'Cliente'
    }
    const extra = locacaoId ? ' Locação Storydoing criada — confira valor/forma de pagamento.' : ''
    await supabase.from('notificacoes').insert({
      tipo: 'contrato_assinado',
      titulo: '📝 Contrato assinado via ZapSign',
      mensagem: `${clienteNome} assinou o contrato${docName ? ' — ' + docName : ''}.${extra}`,
      cliente_id: clienteId,
      para_role: 'admin',
    })
  }

  return new Response(JSON.stringify({
    ok: true,
    status: novoStatus,
    contrato_id: contrato?.id || null,
    cliente_id: clienteId || null,
    locacao_id: locacaoId,
  }), { status: 200 })
})
