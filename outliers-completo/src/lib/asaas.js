import { supabase } from './supabase'

async function asaasRequest(method, path, body) {
  var payload = { method: method, path: path }
  if (body) payload.body = body
  var result = await supabase.functions.invoke('asaas-proxy', { body: payload })
  if (result.error) throw new Error(result.error.message)
  var data = result.data
  if (data && data.errors && data.errors.length > 0) throw new Error(data.errors[0].description || 'Erro Asaas')
  return data
}

export async function syncClienteAsaas(cliente) {
  if (cliente.asaas_customer_id) return cliente.asaas_customer_id
  var payload = { name: cliente.nome }
  if (cliente.email) payload.email = cliente.email
  if (cliente.telefone) payload.mobilePhone = cliente.telefone.replace(/\D/g, '')
  if (cliente.cpf) payload.cpfCnpj = cliente.cpf.replace(/\D/g, '')
  payload.notificationDisabled = false
  var result = await asaasRequest('POST', '/customers', payload)
  return result.id
}

export async function criarCobranca(opts) {
  var payload = {
    customer: opts.asaasCustomerId,
    billingType: opts.billingType || 'UNDEFINED',
    value: opts.valor,
    dueDate: opts.vencimento,
    description: opts.descricao || 'Outliers - Programa',
    externalReference: opts.parcelaId || '',
  }
  return await asaasRequest('POST', '/payments', payload)
}

export async function buscarPixQrCode(paymentId) {
  return await asaasRequest('GET', '/payments/' + paymentId + '/pixQrCode')
}

export async function cancelarCobranca(paymentId) {
  return await asaasRequest('DELETE', '/payments/' + paymentId)
}

export function gerarLinkWhatsApp(telefone, nome, valor, vencimento, linkFatura) {
  var tel = telefone ? telefone.replace(/\D/g, '') : ''
  if (tel.length === 11) tel = '55' + tel
  var msg = 'Ola ' + nome + '! Segue sua cobranca do Programa Outliers no valor de ' + valor + ' com vencimento em ' + vencimento + '. Acesse para pagar: ' + linkFatura
  return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg)
}
