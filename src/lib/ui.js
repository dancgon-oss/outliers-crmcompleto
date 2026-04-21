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
  Ativo:        { bg: '#14532d33', text: '#4ade80', border: '#14532d' },
  Inadimplente: { bg: '#7f1d1d33', text: '#fca5a5', border: '#7f1d1d' },
  Concluido:    { bg: '#1e1b4b33', text: '#a5b4fc', border: '#1e1b4b' },
  Inativo:      { bg: '#1c1c1e33', text: '#8a8a8e', border: '#3a3a3e' },
}

export var PARC_C = {
  Pago:     { bg: '#14532d22', text: '#4ade80', border: '#14532d' },
  Pendente: { bg: '#78350f22', text: '#fbbf24', border: '#78350f' },
  Atrasado: { bg: '#7f1d1d22', text: '#fca5a5', border: '#7f1d1d' },
}

export var EVENTO_STATUS_C = {
  Planejado:    { bg: '#1e3a5f33', text: '#60a5fa', border: '#1e3a5f' },
  'Em Andamento': { bg: '#14532d33', text: '#4ade80', border: '#14532d' },
  Encerrado:    { bg: '#1c1c1e33', text: '#8a8a8e', border: '#3a3a3e' },
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
  PENDING:   'Pendente',
  RECEIVED:  'Recebido',
  CONFIRMED: 'Confirmado',
  OVERDUE:   'Vencido',
  REFUNDED:  'Estornado',
  CANCELLED: 'Cancelado',
}

// Estilos base reutilizáveis (fonte maior = 15px)
export var BASE = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 15,
  color: '#f0ead8',
}

export var INPUT_S = {
  background: '#1c1810',
  border: '1px solid #2a2415',
  color: '#f0ead8',
  padding: '10px 14px',
  fontSize: 15,
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'Inter, sans-serif',
  width: '100%',
  transition: 'border-color .15s',
  boxSizing: 'border-box',
}

export var BTN_PRIMARY = {
  background: 'linear-gradient(135deg,#c9a96e,#a07840)',
  color: '#0a0900',
  border: 'none',
  padding: '10px 20px',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  letterSpacing: '0.01em',
}

export var BTN_GHOST = {
  background: 'none',
  border: '1px solid #3d3420',
  color: '#b8a882',
  padding: '9px 16px',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  fontSize: 14,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export var LABEL_S = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#7a6a4a',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 7,
}

export var CARD_S = {
  background: '#141209',
  border: '1px solid #2a2415',
  borderRadius: 12,
}

export var OVERLAY_S = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.85)',
  zIndex: 300,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
}

export var MODAL_S = {
  background: '#141209',
  border: '1px solid #3d3420',
  borderRadius: 16,
  padding: 32,
  width: 560,
  maxWidth: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
}
