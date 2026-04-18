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
