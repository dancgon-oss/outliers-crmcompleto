export var C = {
  bg:      '#0a0900',
  bgCard:  '#141209',
  bgHover: '#1c1810',
  border:  '#2a2415',
  border2: '#3d3420',
  gold:    '#c9a96e',
  gold2:   '#a07840',
  text:    '#f0ead8',
  text2:   '#b8a882',
  text3:   '#7a6a4a',
  red:     '#e05252',
  green:   '#4ade80',
  yellow:  '#fbbf24',
}

export var STATUS_C = {
  Ativo:        { bg: '#14532d', text: '#4ade80' },
  Inadimplente: { bg: '#7f1d1d', text: '#fca5a5' },
  Concluido:    { bg: '#1e1b4b', text: '#a5b4fc' },
  Inativo:      { bg: '#1c1c1e', text: '#8a8a8e' },
}

export var PARC_C = {
  Pago:     { bg: '#14532d22', text: '#4ade80', border: '#14532d' },
  Pendente: { bg: '#78350f22', text: '#fbbf24', border: '#78350f' },
  Atrasado: { bg: '#7f1d1d22', text: '#fca5a5', border: '#7f1d1d' },
}

export function fmt(v) {
  var n = (v != null) ? Number(v) : 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fmtDate(s) {
  if (!s) return '--'
  var p = String(s).split('T')[0].split('-')
  if (p.length < 3) return s
  return p[2] + '/' + p[1] + '/' + p[0]
}

export function diasAteVencer(vencimento) {
  if (!vencimento) return null
  var hoje = new Date()
  hoje.setHours(0,0,0,0)
  var v = new Date(vencimento + 'T00:00:00')
  return Math.round((v - hoje) / 86400000)
}

export var ASAAS_STATUS_PT = {
  PENDING: 'Pendente',
  RECEIVED: 'Recebido',
  CONFIRMED: 'Confirmado',
  OVERDUE: 'Vencido',
  REFUNDED: 'Estornado',
}

// Formata telefone para "(DDD) numero" — celular: (11) 98765-4321 / fixo: (11) 3456-7890
export function formatTel(t) {
  if (t == null || t === '') return ''
  var d = String(t).replace(/\D/g, '')
  if (!d) return ''
  // Remove DDI 55 quando vem com prefixo (13 ou 12 digitos)
  if (d.length === 13 && d.charAt(0) === '5' && d.charAt(1) === '5') d = d.slice(2)
  else if (d.length === 12 && d.charAt(0) === '5' && d.charAt(1) === '5') d = d.slice(2)
  if (d.length === 11) {
    return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7)
  }
  if (d.length === 10) {
    return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6)
  }
  if (d.length === 9) return d.slice(0,5) + '-' + d.slice(5)
  if (d.length === 8) return d.slice(0,4) + '-' + d.slice(4)
  return String(t)
}

// Mantem apenas digitos (uso ao salvar)
export function unformatTel(t) {
  if (!t) return ''
  return String(t).replace(/\D/g, '')
}

// Formata CPF para 000.000.000-00
export function formatCPF(c) {
  if (c == null || c === '') return ''
  var d = String(c).replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 11) {
    return d.slice(0,3) + '.' + d.slice(3,6) + '.' + d.slice(6,9) + '-' + d.slice(9)
  }
  // Se tem menos digitos, vai formatando o que tem
  if (d.length > 9) return d.slice(0,3) + '.' + d.slice(3,6) + '.' + d.slice(6,9) + '-' + d.slice(9)
  if (d.length > 6) return d.slice(0,3) + '.' + d.slice(3,6) + '.' + d.slice(6)
  if (d.length > 3) return d.slice(0,3) + '.' + d.slice(3)
  return d
}

export function unformatCPF(c) {
  if (!c) return ''
  return String(c).replace(/\D/g, '')
}
