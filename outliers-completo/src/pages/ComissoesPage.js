import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, fmtDate, C } from '../lib/ui'

// ---------- Componentes auxiliares ----------

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: C.text3, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
        {icon && <div style={{ fontSize: 20 }}>{icon}</div>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.text3 }}>{sub}</div>}
    </div>
  )
}

function Tab({ ativo, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: ativo ? C.bgCard : 'transparent',
      border: '1px solid ' + (ativo ? C.gold : C.border),
      color: ativo ? C.gold : C.text3,
      padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
      fontSize: 13, fontWeight: 500, fontFamily: 'Inter,sans-serif', transition: 'all .15s'
    }}>{children}</button>
  )
}

function Pill({ children, cor }) {
  var c = cor || C.text3
  return <span style={{ fontSize: 11, fontWeight: 600, color: c, background: c + '22', padding: '3px 8px', borderRadius: 6, textTransform: 'capitalize' }}>{children}</span>
}

function Modal({ titulo, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div onClick={function(e){ e.stopPropagation() }} style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '24px 28px', minWidth: 460, maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{titulo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text3, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </label>
  )
}

var inputStyle = {
  background: C.bg, color: C.text, border: '1px solid ' + C.border,
  borderRadius: 6, padding: '8px 12px', fontSize: 13, fontFamily: 'Inter,sans-serif', width: '100%'
}

var btnPrimary = {
  background: 'linear-gradient(180deg,#c9a96e,#a07840)', border: 'none', color: '#1a1a1a',
  padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'Inter,sans-serif'
}

var btnGhost = {
  background: 'none', border: '1px solid ' + C.border, color: C.text2,
  padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter,sans-serif'
}

var coresPapel = { comercial: C.gold, marketing: '#a78bfa', operacional: '#60a5fa', financeiro: '#4ade80', outro: C.text3 }

// ---------- Página principal ----------

export default function ComissoesPage({ onNav, perfilUsuario, usuarioId }) {
  var [aba, setAba] = useState('fluxo')
  var podeVerTudo = perfilUsuario === 'admin' || perfilUsuario === 'financeiro'

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: C.bg, fontFamily: 'Inter,sans-serif' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>Comissões</div>
          <div style={{ fontSize: 13, color: C.text3, marginTop: 4 }}>Fluxo, regras e campanhas — liberação automática conforme cliente paga</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tab ativo={aba==='fluxo'} onClick={function(){ setAba('fluxo') }}>Fluxo</Tab>
          <Tab ativo={aba==='extrato'} onClick={function(){ setAba('extrato') }}>Extrato</Tab>
          {podeVerTudo && <Tab ativo={aba==='regras'} onClick={function(){ setAba('regras') }}>Regras</Tab>}
          {podeVerTudo && <Tab ativo={aba==='campanhas'} onClick={function(){ setAba('campanhas') }}>Campanhas</Tab>}
        </div>
      </div>

      {aba === 'fluxo'     && <Fluxo podeVerTudo={podeVerTudo} usuarioId={usuarioId} />}
      {aba === 'extrato'   && <Extrato podeVerTudo={podeVerTudo} usuarioId={usuarioId} />}
      {aba === 'regras'    && podeVerTudo && <Regras />}
      {aba === 'campanhas' && podeVerTudo && <Campanhas />}
    </div>
  )
}

// ---------- ABA: Fluxo (uma linha por parcela do cliente x beneficiario) ----------

function Fluxo({ podeVerTudo, usuarioId }) {
  var [linhas, setLinhas] = useState([])
  var [pessoas, setPessoas] = useState([])
  var [filtroPessoa, setFiltroPessoa] = useState('')
  var [filtroStatus, setFiltroStatus] = useState('')
  var [filtroMes, setFiltroMes] = useState('todos')   // todos | atual | proximo | passado | YYYY-MM
  var [loading, setLoading] = useState(true)

  useEffect(function() { carregar() }, [filtroPessoa, filtroStatus])

  async function carregar() {
    setLoading(true)
    var q = supabase.from('vw_comissoes_parcelas').select('*').order('parcela_vencimento', { ascending: true })
    if (!podeVerTudo) q = q.eq('beneficiario_id', usuarioId)
    else if (filtroPessoa) q = q.eq('beneficiario_id', filtroPessoa)
    if (filtroStatus) q = q.eq('comissao_parcela_status', filtroStatus)
    var [rl, rp] = await Promise.all([
      q,
      supabase.from('profiles').select('id,nome,role').order('nome'),
    ])
    setLinhas(rl.data || [])
    setPessoas(rp.data || [])
    setLoading(false)
  }

  async function marcarParcelaPaga(linha) {
    if (!podeVerTudo) return
    if (!confirm('Marcar parcela ' + linha.parcela_numero + ' do cliente "' + linha.cliente_nome + '" como PAGA?\n\nIsso liberara comissoes proporcionalmente para todos os beneficiarios desta venda.')) return
    var r = await supabase.from('parcelas').update({ status: 'Pago', pago_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', linha.parcela_id)
    if (r.error) return alert('Erro: ' + r.error.message)
    await carregar()
  }

  // Filtro mensal (aplicado em cima das linhas)
  function ymOf(d) {
    if (!d) return ''
    try { var x = new Date(String(d).slice(0,10) + 'T00:00:00'); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') } catch(_e) { return '' }
  }
  var hoje = new Date()
  var ymAtual = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0')
  var prox = new Date(hoje.getFullYear(), hoje.getMonth()+1, 1)
  var ymProx = prox.getFullYear() + '-' + String(prox.getMonth()+1).padStart(2,'0')

  // Lista de meses únicos pra o dropdown
  var mesesUnicos = Array.from(new Set(linhas.map(function(l){ return ymOf(l.parcela_vencimento) }).filter(Boolean))).sort()

  var linhasFiltradas = linhas.filter(function(l) {
    var ym = ymOf(l.parcela_vencimento)
    if (filtroMes === 'todos') return true
    if (filtroMes === 'atual') return ym === ymAtual
    if (filtroMes === 'proximo') return ym === ymProx
    if (filtroMes === 'passado') return ym < ymAtual
    return ym === filtroMes  // YYYY-MM específico
  })

  // Resumo do mês atual e do próximo (independente de filtro)
  var totalMesAtual = linhas.filter(function(l){ return ymOf(l.parcela_vencimento) === ymAtual }).reduce(function(s,l){ return s + Number(l.comissao_parcela_valor||0) }, 0)
  var totalProxMes  = linhas.filter(function(l){ return ymOf(l.parcela_vencimento) === ymProx }).reduce(function(s,l){ return s + Number(l.comissao_parcela_valor||0) }, 0)

  var totalPrevisto = linhasFiltradas.reduce(function(s,l){ return s + Number(l.comissao_parcela_valor||0) }, 0)
  var totalLiberado = linhasFiltradas.filter(function(l){ return l.comissao_parcela_status === 'Liberada' }).reduce(function(s,l){ return s + Number(l.comissao_parcela_valor||0) }, 0)
  var totalAtrasado = linhasFiltradas.filter(function(l){ return l.comissao_parcela_status === 'Atrasada' }).reduce(function(s,l){ return s + Number(l.comissao_parcela_valor||0) }, 0)
  var totalPrevista = linhasFiltradas.filter(function(l){ return l.comissao_parcela_status === 'Prevista' }).reduce(function(s,l){ return s + Number(l.comissao_parcela_valor||0) }, 0)

  // Agrupar por beneficiario (usa as linhas FILTRADAS)
  var porBenef = {}
  linhasFiltradas.forEach(function(l) {
    var k = l.beneficiario_id + '|' + (l.beneficiario_nome || '')
    if (!porBenef[k]) porBenef[k] = { id: l.beneficiario_id, nome: l.beneficiario_nome || '—', papel: l.papel, total:0, liberado:0, prev:0, atras:0 }
    porBenef[k].total += Number(l.comissao_parcela_valor||0)
    if (l.comissao_parcela_status === 'Liberada') porBenef[k].liberado += Number(l.comissao_parcela_valor||0)
    else if (l.comissao_parcela_status === 'Atrasada') porBenef[k].atras += Number(l.comissao_parcela_valor||0)
    else porBenef[k].prev += Number(l.comissao_parcela_valor||0)
  })
  var resumoBenef = Object.values(porBenef).sort(function(a,b){ return b.total - a.total })

  function fmtVenc(d) {
    if (!d) return ''
    try { return new Date(d).toLocaleDateString('pt-BR') } catch(_e) { return d }
  }

  return (<>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:20 }}>
      <StatCard label="Total previsto" value={fmt(totalPrevisto)} sub="todas as parcelas" icon="📊" color={C.text} />
      <StatCard label="Liberado" value={fmt(totalLiberado)} sub="cliente pagou" icon="✅" color="#4ade80" />
      <StatCard label="Atrasado" value={fmt(totalAtrasado)} sub="cliente em atraso" icon="⚠️" color="#fca5a5" />
      <StatCard label="Previsto futuro" value={fmt(totalPrevista)} sub="ainda nao venceu" icon="⏳" color={C.gold} />
    </div>

    {podeVerTudo && resumoBenef.length > 0 && (
      <div style={{ background: C.bgCard, border:'1px solid '+C.border, borderRadius:12, marginBottom:20, padding:'14px 18px' }}>
        <div style={{ fontSize:12, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>Resumo por beneficiário</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:10 }}>
          {resumoBenef.map(function(b) {
            return (
              <div key={b.id} style={{ background:C.bg, border:'1px solid '+C.border, borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{b.nome}</div>
                <div style={{ fontSize:11, color:C.text3, marginBottom:6 }}><Pill cor={coresPapel[b.papel]}>{b.papel}</Pill></div>
                <div style={{ fontSize:11, color:C.text3 }}>Total: <strong style={{ color:C.text2 }}>{fmt(b.total)}</strong></div>
                <div style={{ fontSize:11, color:'#4ade80' }}>Liberado: {fmt(b.liberado)}</div>
                <div style={{ fontSize:11, color:C.gold }}>Previsto: {fmt(b.prev)}</div>
                {b.atras > 0 && <div style={{ fontSize:11, color:'#fca5a5' }}>Atrasado: {fmt(b.atras)}</div>}
              </div>
            )
          })}
        </div>
      </div>
    )}

    {/* Resumo de previsão por mês */}
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'14px 18px' }}>
        <div style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em' }}>📅 Mês atual ({ymAtual})</div>
        <div style={{ fontSize:22, fontWeight:700, color:C.gold, marginTop:4 }}>{fmt(totalMesAtual)}</div>
        <div style={{ fontSize:11, color:C.text3, marginTop:2 }}>previsão de comissões com vencimento neste mês</div>
      </div>
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'14px 18px' }}>
        <div style={{ fontSize:11, color:C.text3, textTransform:'uppercase', letterSpacing:'.08em' }}>🗓️ Próximo mês ({ymProx})</div>
        <div style={{ fontSize:22, fontWeight:700, color:'#a78bfa', marginTop:4 }}>{fmt(totalProxMes)}</div>
        <div style={{ fontSize:11, color:C.text3, marginTop:2 }}>previsão para o próximo mês</div>
      </div>
    </div>

    <div style={{ marginBottom: 14, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
      <select value={filtroMes} onChange={function(e){ setFiltroMes(e.target.value) }} style={{ ...inputStyle, width:180 }}>
        <option value="todos">📅 Todos os meses</option>
        <option value="passado">Passados</option>
        <option value="atual">Mês atual</option>
        <option value="proximo">Próximo mês</option>
        <option disabled>──────────</option>
        {mesesUnicos.map(function(m){ return <option key={m} value={m}>{m}</option> })}
      </select>
      {podeVerTudo && (
        <select value={filtroPessoa} onChange={function(e){ setFiltroPessoa(e.target.value) }} style={{ ...inputStyle, width:220 }}>
          <option value="">Todos beneficiários</option>
          {pessoas.map(function(p){ return <option key={p.id} value={p.id}>{p.nome}</option> })}
        </select>
      )}
      <select value={filtroStatus} onChange={function(e){ setFiltroStatus(e.target.value) }} style={{ ...inputStyle, width:180 }}>
        <option value="">Todos os status</option>
        <option value="Prevista">Prevista</option>
        <option value="Liberada">Liberada</option>
        <option value="Atrasada">Atrasada</option>
      </select>
      {filtroMes !== 'todos' && (
        <span style={{ fontSize:11, color:C.text3 }}>Exibindo {linhasFiltradas.length} de {linhas.length} parcelas</span>
      )}
    </div>

    <div style={{ background: C.bgCard, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden' }}>
      {loading ? (
        <div style={{ padding:24, color:C.text3, fontStyle:'italic' }}>Carregando...</div>
      ) : linhasFiltradas.length === 0 ? (
        <div style={{ padding:24, color:C.text3, fontStyle:'italic' }}>Nenhuma parcela {linhas.length > 0 ? 'no filtro selecionado' : 'de comissão'}.</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background: C.bgHover }}>
              {['Beneficiário','Papel','Cliente','Curso','Parcela','Vencimento','Cliente paga','%','Comissão','Status', podeVerTudo?'':null].filter(Boolean).map(function(h,i){
                return <th key={i} style={{ textAlign:'left', padding:'12px 14px', fontSize:11, color:C.text3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {linhasFiltradas.map(function(l) {
              var corStatus = l.comissao_parcela_status === 'Liberada' ? '#4ade80'
                            : l.comissao_parcela_status === 'Atrasada' ? '#fca5a5'
                            : C.gold
              return (
                <tr key={l.comissao_id+'_'+l.parcela_id} style={{ borderTop:'1px solid '+C.border }}>
                  <td style={{ padding:'10px 14px', fontSize:13, color:C.text }}>{l.beneficiario_nome || '—'}</td>
                  <td style={{ padding:'10px 14px' }}><Pill cor={coresPapel[l.papel]}>{l.papel}</Pill></td>
                  <td style={{ padding:'10px 14px', fontSize:13, color:C.text2 }}>{l.cliente_nome || '—'}</td>
                  <td style={{ padding:'10px 14px', fontSize:13, color:C.text2 }}>{l.curso_nome || '—'}</td>
                  <td style={{ padding:'10px 14px', fontSize:13, color:C.text2 }}>#{l.parcela_numero}</td>
                  <td style={{ padding:'10px 14px', fontSize:13, color:C.text2 }}>{fmtVenc(l.parcela_vencimento)}</td>
                  <td style={{ padding:'10px 14px', fontSize:13, color:C.text2 }}>{fmt(l.parcela_valor_cliente)}</td>
                  <td style={{ padding:'10px 14px', fontSize:12, color:C.text3 }}>{Number(l.percentual||0).toFixed(2)}%</td>
                  <td style={{ padding:'10px 14px', fontSize:13, fontWeight:600, color:corStatus }}>{fmt(l.comissao_parcela_valor)}</td>
                  <td style={{ padding:'10px 14px' }}><Pill cor={corStatus}>{l.comissao_parcela_status}</Pill></td>
                  {podeVerTudo && (
                    <td style={{ padding:'10px 14px', textAlign:'right', whiteSpace:'nowrap' }}>
                      {l.parcela_status !== 'Pago' && (
                        <button onClick={function(){ marcarParcelaPaga(l) }} style={btnPrimary}>Marcar pago</button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  </>)
}

// ---------- ABA: Extrato ----------

function Extrato({ podeVerTudo, usuarioId }) {
  var [comissoes, setComissoes] = useState([])
  var [pessoas, setPessoas] = useState([])
  var [filtroPessoa, setFiltroPessoa] = useState('')
  var [filtroPapel, setFiltroPapel] = useState('')
  var [loading, setLoading] = useState(true)
  var [aberta, setAberta] = useState(null)
  var [movimentos, setMovimentos] = useState([])

  useEffect(function() { carregar() }, [filtroPessoa, filtroPapel])

  async function carregar() {
    setLoading(true)
    var q = supabase.from('vw_comissoes_resumo').select('*').order('created_at', { ascending: false })
    if (!podeVerTudo) q = q.eq('beneficiario_id', usuarioId)
    else if (filtroPessoa) q = q.eq('beneficiario_id', filtroPessoa)
    if (filtroPapel) q = q.eq('papel', filtroPapel)
    var [rc, rp] = await Promise.all([
      q,
      supabase.from('profiles').select('id,nome,role').order('nome'),
    ])
    setComissoes(rc.data || [])
    setPessoas(rp.data || [])
    setLoading(false)
  }

  async function abrir(c) {
    setAberta(c)
    var { data } = await supabase.from('comissao_movimentos').select('*').eq('comissao_id', c.id).order('created_at', { ascending: false })
    setMovimentos(data || [])
  }

  async function pagar(c) {
    var aPagar = Number(c.valor_a_pagar || 0)
    if (aPagar <= 0) return alert('Não há valor a pagar nesta comissão.')

    // Busca PIX e telefone do beneficiário
    var benef = await supabase.from('profiles').select('nome, pix, telefone').eq('id', c.beneficiario_id).maybeSingle()
    var pix = benef.data && benef.data.pix
    var info = 'Beneficiário: ' + (c.beneficiario_nome || (benef.data && benef.data.nome) || '?') + '\n'
    info += 'Disponível para pagar: ' + fmt(aPagar) + '\n'
    if (pix) info += 'CHAVE PIX: ' + pix + '\n'
    else info += '(sem PIX cadastrado — peça ao usuário cadastrar em Usuários)\n'
    info += '\nValor a pagar agora (deixe em branco = total)\n'
    info += '(máximo: ' + aPagar.toFixed(2) + ')'

    var input = prompt(info, aPagar.toFixed(2))
    if (input === null) return
    var v = input.trim() === '' ? aPagar : Number(input.replace(',', '.'))
    if (isNaN(v) || v <= 0) return alert('Valor inválido.')
    if (v > aPagar + 0.01) return alert('Valor maior que o disponível.')

    // Copia PIX pro clipboard se existir
    if (pix && navigator.clipboard) {
      try { await navigator.clipboard.writeText(pix) } catch(_e) {}
    }

    var obs = prompt('Observação (opcional):' + (pix ? '\n\nO PIX já foi copiado para sua área de transferência.' : ''), '') || null

    var { error } = await supabase.from('comissao_movimentos').insert({
      comissao_id: c.id, tipo: 'pagamento', valor: v, descricao: obs, criado_por: usuarioId
    })
    if (error) return alert('Erro: ' + error.message)
    var novoPago = Number(c.valor_pago || 0) + v
    var novoStatus = (novoPago >= Number(c.valor_total || 0) - 0.01) ? 'Quitada' : 'Aberta'
    await supabase.from('comissoes').update({ valor_pago: novoPago, status: novoStatus, updated_at: new Date().toISOString() }).eq('id', c.id)
    await carregar()
    if (aberta && aberta.id === c.id) await abrir({ ...c, valor_pago: novoPago })
  }

  var totLib = comissoes.reduce(function(s,c){ return s + Number(c.valor_liberado||0) }, 0)
  var totPagar = comissoes.reduce(function(s,c){ return s + Number(c.valor_a_pagar||0) }, 0)
  var totPago = comissoes.reduce(function(s,c){ return s + Number(c.valor_pago||0) }, 0)
  var totRepr = comissoes.reduce(function(s,c){ return s + Number(c.valor_represado||0) }, 0)

  return (<>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
      <StatCard label="Total liberado" value={fmt(totLib)} sub="parcelas pagas" icon="✅" color="#4ade80" />
      <StatCard label="A pagar agora"  value={fmt(totPagar)} sub="liberado e em aberto" icon="💸" color={C.gold} />
      <StatCard label="Já pago"        value={fmt(totPago)} sub="histórico" icon="📤" />
      <StatCard label="Represado"      value={fmt(totRepr)} sub="aguardando parcelas" icon="⏳" />
    </div>

    {podeVerTudo && (
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filtroPessoa} onChange={function(e){ setFiltroPessoa(e.target.value) }} style={{ ...inputStyle, width: 220 }}>
          <option value="">Todos beneficiários</option>
          {pessoas.map(function(p){ return <option key={p.id} value={p.id}>{p.nome}</option> })}
        </select>
        <select value={filtroPapel} onChange={function(e){ setFiltroPapel(e.target.value) }} style={{ ...inputStyle, width: 200 }}>
          <option value="">Todos os papéis</option>
          <option value="comercial">Comercial</option>
          <option value="marketing">Marketing</option>
          <option value="operacional">Operacional</option>
          <option value="financeiro">Financeiro</option>
          <option value="outro">Outro</option>
        </select>
      </div>
    )}

    <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' }}>
      {loading ? (
        <div style={{ padding: 24, color: C.text3, fontStyle: 'italic' }}>Carregando...</div>
      ) : comissoes.length === 0 ? (
        <div style={{ padding: 24, color: C.text3, fontStyle: 'italic' }}>Nenhuma comissão. Cadastre regras na aba "Regras" para que vendas futuras gerem comissões automaticamente.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.bgHover }}>
              {['Beneficiário','Papel','Cliente','Curso','%','Total','Liberado','A pagar','Status',''].map(function(h,i){
                return <th key={i} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 11, color: C.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {comissoes.map(function(c) {
              return (
                <tr key={c.id} style={{ borderTop: '1px solid ' + C.border }}>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.text }}>{c.beneficiario_nome}</td>
                  <td style={{ padding: '12px 14px' }}><Pill cor={coresPapel[c.papel]}>{c.papel}</Pill></td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.text2 }}>{c.cliente_nome}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.text2 }}>{c.curso_nome}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.text2 }}>{Number(c.percentual).toFixed(2)}%</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.text }}>{fmt(c.valor_total)}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: '#4ade80' }}>{fmt(c.valor_liberado)}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.gold, fontWeight: 600 }}>{fmt(c.valor_a_pagar)}</td>
                  <td style={{ padding: '12px 14px' }}><Pill cor={c.status==='Quitada'?'#4ade80':c.status==='Cancelada'?C.text3:C.gold}>{c.status}</Pill></td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={function(){ abrir(c) }} style={{ ...btnGhost, marginRight: 6 }}>Detalhes</button>
                    {podeVerTudo && Number(c.valor_a_pagar) > 0 && (
                      <button onClick={function(){ pagar(c) }} style={btnPrimary}>Pagar</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>

    {aberta && (
      <Modal titulo={aberta.beneficiario_nome + ' · ' + aberta.cliente_nome} onClose={function(){ setAberta(null); setMovimentos([]) }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div style={{ padding: 12, background: C.bg, borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase' }}>Total</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{fmt(aberta.valor_total)}</div>
          </div>
          <div style={{ padding: 12, background: C.bg, borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase' }}>A pagar</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>{fmt(aberta.valor_a_pagar)}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.text3, marginBottom: 10 }}>
          <Pill cor={coresPapel[aberta.papel]}>{aberta.papel}</Pill>
          {aberta.campanha_nome && <span style={{ marginLeft: 8 }}>Campanha: <strong style={{ color: C.text2 }}>{aberta.campanha_nome}</strong></span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Movimentos</div>
        {movimentos.length === 0 ? (
          <div style={{ fontSize: 12, color: C.text3, fontStyle: 'italic' }}>Sem movimentos. Liberações aparecem quando parcelas do cliente são pagas.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {movimentos.map(function(m) {
              var cor = m.tipo === 'pagamento' ? C.gold : m.tipo === 'estorno' ? '#fca5a5' : '#4ade80'
              var sinal = m.tipo === 'liberacao' ? '+' : '−'
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: C.bg, borderRadius: 8, border: '1px solid ' + C.border }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: cor, textTransform: 'capitalize' }}>{m.tipo}</div>
                    <div style={{ fontSize: 11, color: C.text3 }}>{fmtDate(m.created_at)} {m.descricao ? '· ' + m.descricao : ''}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: cor }}>{sinal} {fmt(m.valor)}</div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    )}
  </>)
}

// ---------- ABA: Regras ----------

function Regras() {
  var [regras, setRegras] = useState([])
  var [cursos, setCursos] = useState([])
  var [pessoas, setPessoas] = useState([])
  var [novoAberto, setNovoAberto] = useState(false)
  var [loading, setLoading] = useState(true)

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var [rr, rc, rp] = await Promise.all([
      supabase.from('comissao_regras').select('*, cursos(nome), profiles(nome)').order('created_at', { ascending: false }),
      supabase.from('cursos').select('id,nome,categoria,ativo').eq('ativo', true).order('ordem'),
      supabase.from('profiles').select('id,nome,role').order('nome'),
    ])
    setRegras(rr.data || [])
    setCursos(rc.data || [])
    setPessoas(rp.data || [])
    setLoading(false)
  }

  async function salvarPercentual(regraId, valor) {
    var pct = Number(valor)
    if (isNaN(pct) || pct < 0 || pct > 100) return alert('% inválido (0-100).')
    await supabase.from('comissao_regras').update({ percentual: pct, updated_at: new Date().toISOString() }).eq('id', regraId)
    await carregar()
  }

  async function alternarAtiva(r) {
    await supabase.from('comissao_regras').update({ ativa: !r.ativa, updated_at: new Date().toISOString() }).eq('id', r.id)
    await carregar()
  }

  async function excluir(r) {
    if (!confirm('Excluir esta regra? Comissões já criadas não serão afetadas.')) return
    await supabase.from('comissao_regras').delete().eq('id', r.id)
    await carregar()
  }

  async function aplicarEmTodas() {
    if (!confirm('Aplicar TODAS as regras ativas em TODAS as vendas existentes?\n\nNão vai duplicar (pula vendas que já têm a comissão).\nLibera retroativo para parcelas já pagas.\n\nProsseguir?')) return
    var { data, error } = await supabase.rpc('aplicar_regras_em_todas_vendas')
    if (error) return alert('Erro: ' + error.message)
    var msg = 'Regularização concluída:\n\n'
      + '• Vendas processadas: ' + (data.vendas_processadas || 0) + '\n'
      + '• Comissões criadas: ' + (data.comissoes_criadas || 0) + '\n'
      + '• Já existentes (puladas): ' + (data.comissoes_existentes || 0)
    if (data.vendas_sem_curso) msg += '\n• Vendas sem curso vinculado: ' + data.vendas_sem_curso + ' (precisam ser editadas)'
    alert(msg)
  }

  return (<>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap:10, flexWrap:'wrap' }}>
      <div style={{ fontSize: 13, color: C.text3, flex:'1 1 380px' }}>
        Cada regra responde: <strong style={{ color: C.text2 }}>quando vender este curso, quanto esta pessoa ganha?</strong> O percentual vigente no momento da venda é congelado na comissão — alterar a regra não afeta vendas passadas.
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={aplicarEmTodas} style={{ ...btnGhost, padding:'8px 14px', fontSize:12 }} title="Aplica todas as regras ativas em todas as vendas existentes">🔄 Aplicar em todas</button>
        <button onClick={function(){ setNovoAberto(true) }} style={btnPrimary}>+ Nova regra</button>
      </div>
    </div>

    <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' }}>
      {loading ? (
        <div style={{ padding: 24, color: C.text3, fontStyle: 'italic' }}>Carregando...</div>
      ) : regras.length === 0 ? (
        <div style={{ padding: 24, color: C.text3, fontStyle: 'italic' }}>Nenhuma regra cadastrada. Clique em "+ Nova regra" para começar.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.bgHover }}>
              {['Curso','Beneficiário','Papel','% Comissão','Ativa',''].map(function(h,i){
                return <th key={i} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 11, color: C.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {regras.map(function(r) {
              return (
                <tr key={r.id} style={{ borderTop: '1px solid ' + C.border, opacity: r.ativa ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: C.text }}>{r.cursos && r.cursos.nome}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: C.text2 }}>{r.profiles && r.profiles.nome}</td>
                  <td style={{ padding: '10px 14px' }}><Pill cor={coresPapel[r.papel]}>{r.papel}</Pill></td>
                  <td style={{ padding: '10px 14px' }}>
                    <input type="number" step="0.5" min="0" max="100" defaultValue={Number(r.percentual).toFixed(2)}
                      onBlur={function(e){ if (Number(e.target.value) !== Number(r.percentual)) salvarPercentual(r.id, e.target.value) }}
                      style={{ ...inputStyle, width: 80 }} /> %
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <button onClick={function(){ alternarAtiva(r) }} style={btnGhost}>{r.ativa ? 'Sim' : 'Não'}</button>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button onClick={function(){ excluir(r) }} style={{ ...btnGhost, color: '#fca5a5', borderColor: '#fca5a544' }}>Excluir</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>

    {novoAberto && <NovaRegra cursos={cursos} pessoas={pessoas} onClose={function(){ setNovoAberto(false) }} onSalvo={function(){ setNovoAberto(false); carregar() }} />}
  </>)
}

function NovaRegra({ cursos, pessoas, onClose, onSalvo }) {
  var [cursoId, setCursoId] = useState('')
  var [profileId, setProfileId] = useState('')
  var [papel, setPapel] = useState('comercial')
  var [percentual, setPercentual] = useState('')
  var [salvando, setSalvando] = useState(false)

  async function salvar() {
    if (!cursoId || !profileId || !papel) return alert('Preencha curso, pessoa e papel.')
    var pct = Number((percentual || '').toString().replace(',','.'))
    if (isNaN(pct) || pct <= 0 || pct > 100) return alert('% deve ser maior que zero e até 100.')
    setSalvando(true)
    var { error } = await supabase.from('comissao_regras').insert({
      curso_id: cursoId, profile_id: profileId, papel: papel, percentual: pct, ativa: true
    })
    setSalvando(false)
    if (error) return alert('Erro: ' + error.message + (error.code === '23505' ? '\n(Já existe uma regra para esta combinação curso × pessoa × papel.)' : ''))
    onSalvo()
  }

  return (
    <Modal titulo="Nova regra de comissão" onClose={onClose}>
      <Field label="Curso">
        <select value={cursoId} onChange={function(e){ setCursoId(e.target.value) }} style={inputStyle}>
          <option value="">Selecione...</option>
          {cursos.map(function(c){ return <option key={c.id} value={c.id}>{c.nome} ({c.categoria})</option> })}
        </select>
      </Field>
      <Field label="Beneficiário">
        <select value={profileId} onChange={function(e){ setProfileId(e.target.value) }} style={inputStyle}>
          <option value="">Selecione...</option>
          {pessoas.map(function(p){ return <option key={p.id} value={p.id}>{p.nome} {p.role ? '(' + p.role + ')' : ''}</option> })}
        </select>
      </Field>
      <Field label="Papel nesta regra">
        <select value={papel} onChange={function(e){ setPapel(e.target.value) }} style={inputStyle}>
          <option value="comercial">Comercial — só recebe se for o vendedor da venda</option>
          <option value="marketing">Marketing — só recebe se trouxe o lead via campanha</option>
          <option value="operacional">Operacional — recebe sempre que vende este curso</option>
          <option value="financeiro">Financeiro — recebe sempre que vende este curso</option>
          <option value="outro">Outro — recebe sempre que vende este curso</option>
        </select>
      </Field>
      <Field label="Percentual (%)">
        <input type="number" step="0.5" min="0.01" max="100" value={percentual} onChange={function(e){ setPercentual(e.target.value) }} style={inputStyle} placeholder="ex.: 10" />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button onClick={onClose} style={btnGhost}>Cancelar</button>
        <button onClick={salvar} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

// ---------- ABA: Campanhas ----------

function Campanhas() {
  var [campanhas, setCampanhas] = useState([])
  var [pessoas, setPessoas] = useState([])
  var [novoAberto, setNovoAberto] = useState(false)
  var [loading, setLoading] = useState(true)

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var [rc, rp] = await Promise.all([
      supabase.from('campanhas').select('*, profiles(nome)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id,nome').order('nome'),
    ])
    setCampanhas(rc.data || [])
    setPessoas(rp.data || [])
    setLoading(false)
  }

  async function alternar(c) {
    await supabase.from('campanhas').update({ ativa: !c.ativa, updated_at: new Date().toISOString() }).eq('id', c.id)
    await carregar()
  }

  async function excluir(c) {
    if (!confirm('Excluir campanha? Comissões já criadas mantêm a referência.')) return
    await supabase.from('campanhas').delete().eq('id', c.id)
    await carregar()
  }

  return (<>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: C.text3, maxWidth: 720 }}>
        Cada campanha vincula um <strong style={{ color: C.text2 }}>UTM</strong> (que vem nos links de anúncio/site) a uma pessoa do marketing. Quando um cliente é cadastrado com esse UTM, vendas geradas creditam a comissão de marketing para essa pessoa. Sem UTM cadastrado, marketing não recebe.
      </div>
      <button onClick={function(){ setNovoAberto(true) }} style={btnPrimary}>+ Nova campanha</button>
    </div>

    <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, overflow: 'hidden' }}>
      {loading ? (
        <div style={{ padding: 24, color: C.text3, fontStyle: 'italic' }}>Carregando...</div>
      ) : campanhas.length === 0 ? (
        <div style={{ padding: 24, color: C.text3, fontStyle: 'italic' }}>Nenhuma campanha cadastrada.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C.bgHover }}>
              {['Nome','utm_source','utm_campaign','Responsável (MKT)','Ativa',''].map(function(h,i){
                return <th key={i} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 11, color: C.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {campanhas.map(function(c) {
              return (
                <tr key={c.id} style={{ borderTop: '1px solid ' + C.border, opacity: c.ativa ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: C.text }}>{c.nome}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: C.text2, fontFamily: 'monospace' }}>{c.utm_source || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: C.text2, fontFamily: 'monospace' }}>{c.utm_campaign || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: C.text2 }}>{c.profiles && c.profiles.nome || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <button onClick={function(){ alternar(c) }} style={btnGhost}>{c.ativa ? 'Sim' : 'Não'}</button>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button onClick={function(){ excluir(c) }} style={{ ...btnGhost, color: '#fca5a5', borderColor: '#fca5a544' }}>Excluir</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>

    {novoAberto && <NovaCampanha pessoas={pessoas} onClose={function(){ setNovoAberto(false) }} onSalvo={function(){ setNovoAberto(false); carregar() }} />}
  </>)
}

function NovaCampanha({ pessoas, onClose, onSalvo }) {
  var [nome, setNome] = useState('')
  var [utmSource, setUtmSource] = useState('')
  var [utmCampaign, setUtmCampaign] = useState('')
  var [responsavelId, setResponsavelId] = useState('')
  var [salvando, setSalvando] = useState(false)

  async function salvar() {
    if (!nome.trim()) return alert('Nome da campanha é obrigatório.')
    if (!utmSource.trim() && !utmCampaign.trim()) return alert('Informe ao menos utm_source ou utm_campaign.')
    if (!responsavelId) return alert('Escolha o responsável pelo marketing.')
    setSalvando(true)
    var { error } = await supabase.from('campanhas').insert({
      nome: nome.trim(),
      utm_source: utmSource.trim() || null,
      utm_campaign: utmCampaign.trim() || null,
      responsavel_id: responsavelId, ativa: true
    })
    setSalvando(false)
    if (error) return alert('Erro: ' + error.message)
    onSalvo()
  }

  return (
    <Modal titulo="Nova campanha de marketing" onClose={onClose}>
      <Field label="Nome (referência interna)">
        <input value={nome} onChange={function(e){ setNome(e.target.value) }} placeholder="ex.: Paradigma — Facebook Q2" style={inputStyle} />
      </Field>
      <Field label="utm_source (ex.: facebook, google, instagram)">
        <input value={utmSource} onChange={function(e){ setUtmSource(e.target.value) }} placeholder="facebook" style={inputStyle} />
      </Field>
      <Field label="utm_campaign (opcional, mais específico)">
        <input value={utmCampaign} onChange={function(e){ setUtmCampaign(e.target.value) }} placeholder="paradigma_jan26" style={inputStyle} />
      </Field>
      <Field label="Responsável (membro do marketing)">
        <select value={responsavelId} onChange={function(e){ setResponsavelId(e.target.value) }} style={inputStyle}>
          <option value="">Selecione...</option>
          {pessoas.map(function(p){ return <option key={p.id} value={p.id}>{p.nome}</option> })}
        </select>
      </Field>
      <div style={{ fontSize: 11, color: C.text3, marginBottom: 12, padding: 10, background: C.bg, borderRadius: 6, border: '1px solid ' + C.border }}>
        💡 Dica: utm_campaign tem prioridade sobre utm_source. Se preencher os dois, casa por campaign primeiro.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnGhost}>Cancelar</button>
        <button onClick={salvar} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}
