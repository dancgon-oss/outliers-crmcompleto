import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmtDate, C } from '../lib/ui'

// Portal do aluno: vê só os cursos em que foi matriculado + progresso pessoal.
// Login compartilha auth.users com o admin; App.js roteia por role.

function embedUrl(videoUrl) {
  if (!videoUrl) return null
  var s = String(videoUrl).trim()
  // YouTube formats: watch?v=, youtu.be/, /embed/
  var ytMatch = s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/)
  if (ytMatch) return 'https://www.youtube.com/embed/' + ytMatch[1]
  // Vimeo: vimeo.com/<id>
  var vmMatch = s.match(/vimeo\.com\/(\d+)/)
  if (vmMatch) return 'https://player.vimeo.com/video/' + vmMatch[1]
  // Default: assume já é embeddable (MP4, webm, outra iframe)
  return s
}

export default function PortalAluno() {
  var auth = useAuth()
  var [clienteId, setClienteId] = useState(null)
  var [clienteNotFound, setClienteNotFound] = useState(false)
  var [matriculas, setMatriculas] = useState([])
  var [loading, setLoading] = useState(true)
  var [cursoAtivo, setCursoAtivo] = useState(null)    // curso selecionado
  var [modulos, setModulos] = useState([])
  var [moduloAtivo, setModuloAtivo] = useState(null)
  var [progressoMap, setProgressoMap] = useState({})  // modulo_id → progresso row

  // ─── Carrega cliente pelo e-mail do profile ───
  useEffect(function() {
    if (!auth.profile) return
    fetchCliente()
  }, [auth.profile])

  async function fetchCliente() {
    setLoading(true)
    setClienteNotFound(false)
    var email = (auth.profile.email || '').toLowerCase()
    var { data } = await supabase.from('clientes').select('id,nome').ilike('email', email).limit(1).maybeSingle()
    if (!data) {
      setClienteNotFound(true)
      setLoading(false)
      return
    }
    setClienteId(data.id)
    await fetchMatriculas(data.id)
    setLoading(false)
  }

  async function fetchMatriculas(cId) {
    var { data } = await supabase
      .from('matriculas')
      .select('id,tipo,status,matriculado_em,expira_em,cursos(id,nome,slug,descricao,capa_url,duracao_horas)')
      .eq('cliente_id', cId)
      .eq('status', 'Ativa')
      .order('matriculado_em', { ascending: false })
    setMatriculas(data || [])
  }

  async function abrirCurso(matricula) {
    var curso = matricula.cursos
    if (!curso) return
    setCursoAtivo(curso)
    setModuloAtivo(null)
    var { data } = await supabase.from('modulos').select('*').eq('curso_id', curso.id).order('ordem').order('created_at')
    setModulos(data || [])
    // Carrega progresso do aluno nesses módulos
    if (data && data.length && clienteId) {
      var ids = data.map(function(m){ return m.id })
      var { data: progs } = await supabase
        .from('progresso_modulos')
        .select('*')
        .eq('cliente_id', clienteId)
        .in('modulo_id', ids)
      var map = {}
      ;(progs || []).forEach(function(p){ map[p.modulo_id] = p })
      setProgressoMap(map)
      // Auto-seleciona primeiro não concluído, senão o primeiro
      var proximo = data.find(function(m){ return !map[m.id] || !map[m.id].concluido_em }) || data[0]
      setModuloAtivo(proximo)
      if (proximo && (!map[proximo.id])) await registrarInicio(proximo.id)
    }
  }

  async function registrarInicio(moduloId) {
    var { data } = await supabase.from('progresso_modulos').upsert({
      cliente_id: clienteId, modulo_id: moduloId, iniciado_em: new Date().toISOString(),
    }, { onConflict: 'cliente_id,modulo_id', ignoreDuplicates: true }).select().maybeSingle()
    if (data) setProgressoMap(function(p){ return { ...p, [moduloId]: data } })
  }

  async function marcarConcluido(moduloId) {
    var existing = progressoMap[moduloId]
    var agora = new Date().toISOString()
    if (existing) {
      await supabase.from('progresso_modulos').update({ concluido_em: agora }).eq('id', existing.id)
      setProgressoMap(function(p){ return { ...p, [moduloId]: { ...existing, concluido_em: agora } } })
    } else {
      var r = await supabase.from('progresso_modulos').insert({
        cliente_id: clienteId, modulo_id: moduloId, iniciado_em: agora, concluido_em: agora,
      }).select().single()
      if (r.data) setProgressoMap(function(p){ return { ...p, [moduloId]: r.data } })
    }
  }

  async function desmarcarConcluido(moduloId) {
    var existing = progressoMap[moduloId]
    if (!existing) return
    await supabase.from('progresso_modulos').update({ concluido_em: null }).eq('id', existing.id)
    setProgressoMap(function(p){ return { ...p, [moduloId]: { ...existing, concluido_em: null } } })
  }

  function selecionarModulo(m) {
    setModuloAtivo(m)
    if (!progressoMap[m.id]) registrarInicio(m.id)
  }

  function voltarCatalogo() {
    setCursoAtivo(null); setModulos([]); setModuloAtivo(null); setProgressoMap({})
  }

  var S = {
    bg: { background: C.bg, color: C.text, fontFamily: 'Inter,sans-serif', minHeight: '100vh' },
    card: { background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12 },
    btnG: { background: 'linear-gradient(135deg,#c9a96e,#a07840)', color: '#0a0900', border: 'none', padding: '10px 20px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
    btnGhost: { background: 'none', border: '1px solid ' + C.border2, color: C.text2, padding: '8px 16px', borderRadius: 8, fontFamily: 'Inter,sans-serif', fontSize: 12, cursor: 'pointer' },
  }

  var gold = 'linear-gradient(180deg,#c9a96e,#a07840)'

  return (
    <div style={S.bg}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        *{box-sizing:border-box}
        html,body{margin:0;background:${C.bg}}
        ::-webkit-scrollbar{width:8px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
      `}</style>

      {/* Header */}
      <header style={{ padding: '16px 28px', borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.bgCard }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#1a1200', fontSize: 15 }}>O</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.1em', color: C.text }}>OUTLIERS</div>
            <div style={{ fontSize: 10, color: C.text3, letterSpacing: '.15em', textTransform: 'uppercase' }}>Portal do Aluno</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {auth.profile && <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{auth.profile.nome}</div>
            <div style={{ fontSize: 11, color: C.text3 }}>{auth.profile.email}</div>
          </div>}
          <button style={S.btnGhost} onClick={auth.signOut}>Sair</button>
        </div>
      </header>

      {loading && <div style={{ padding: 60, textAlign: 'center', color: C.text3, fontSize: 13 }}>Carregando...</div>}

      {!loading && clienteNotFound && (
        <div style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center', padding: '0 24px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 10 }}>Seu acesso ainda não está vinculado</div>
          <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>
            Não localizamos um cadastro de aluno com o e-mail <b style={{ color: C.gold }}>{auth.profile && auth.profile.email}</b>.
            Entre em contato com a equipe pra vincular seu acesso.
          </div>
        </div>
      )}

      {!loading && !clienteNotFound && !cursoAtivo && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 28px' }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>Meus cursos</div>
          <div style={{ fontSize: 13, color: C.text3, marginBottom: 28 }}>
            {matriculas.length} curso{matriculas.length !== 1 ? 's' : ''} disponíve{matriculas.length !== 1 ? 'is' : 'l'} no seu acesso.
          </div>

          {matriculas.length === 0
            ? (
              <div style={{ padding: 50, textAlign: 'center', color: C.text3, fontSize: 14, fontStyle: 'italic', ...S.card }}>
                Você ainda não tem cursos matriculados. A equipe libera o acesso aos seus cursos após a inscrição.
              </div>
            )
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 18 }}>
                {matriculas.map(function(m) {
                  var c = m.cursos
                  if (!c) return null
                  return (
                    <div key={m.id} onClick={function(){ abrirCurso(m) }}
                      style={{ ...S.card, cursor: 'pointer', overflow: 'hidden', transition: 'transform .15s, border-color .15s' }}
                      onMouseEnter={function(e){ e.currentTarget.style.borderColor = C.gold }}
                      onMouseLeave={function(e){ e.currentTarget.style.borderColor = C.border }}>
                      <div style={{ height: 120, background: c.capa_url ? 'url(' + c.capa_url + ') center/cover' : gold, position: 'relative' }}>
                        {!c.capa_url && (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, fontWeight: 800, color: '#1a1200', letterSpacing: '.05em' }}>
                            {c.nome.slice(0, 3).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div style={{ padding: 18 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>{c.nome}</div>
                        {c.descricao && <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.5, marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.descricao}</div>}
                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: C.text3 }}>
                          {c.duracao_horas && <span>⏱ {c.duracao_horas}h</span>}
                          <span>· {m.tipo}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>
      )}

      {!loading && cursoAtivo && (
        <div style={{ display: 'flex', height: 'calc(100vh - 70px)' }}>
          {/* Sidebar: lista de módulos */}
          <div style={{ width: 320, borderRight: '1px solid ' + C.border, display: 'flex', flexDirection: 'column', background: C.bgCard, flexShrink: 0 }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + C.border }}>
              <button style={{ ...S.btnGhost, marginBottom: 10, fontSize: 11, padding: '5px 10px' }} onClick={voltarCatalogo}>← Voltar</button>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{cursoAtivo.nome}</div>
              {(function(){
                var total = modulos.length
                var done = Object.values(progressoMap).filter(function(p){ return p && p.concluido_em }).length
                var pct = total > 0 ? Math.round(done / total * 100) : 0
                return (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.text3, marginBottom: 4 }}>
                      <span>Progresso</span><span>{done}/{total} ({pct}%)</span>
                    </div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct + '%', background: gold, transition: 'width .3s' }} />
                    </div>
                  </div>
                )
              })()}
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {modulos.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.text3, fontSize: 13, fontStyle: 'italic' }}>Nenhum módulo publicado.</div>}
              {modulos.map(function(m, i) {
                var prog = progressoMap[m.id]
                var done = prog && prog.concluido_em
                var active = moduloAtivo && moduloAtivo.id === m.id
                return (
                  <div key={m.id} onClick={function(){ selecionarModulo(m) }}
                    style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.border, background: active ? C.bgHover : 'transparent', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 22, height: 22, borderRadius: 11, border: '1.5px solid ' + (done ? '#4ade80' : C.border2), background: done ? '#14532d22' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: done ? '#4ade80' : C.text3, fontSize: 12, fontWeight: 700 }}>
                      {done ? '✓' : i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? C.gold : C.text }}>{m.nome}</div>
                      {m.duracao_min && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{m.duracao_min} min</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Conteúdo do módulo */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!moduloAtivo && <div style={{ padding: 60, textAlign: 'center', color: C.text3 }}>Selecione um módulo à esquerda.</div>}
            {moduloAtivo && (() => {
              var emb = embedUrl(moduloAtivo.video_url)
              var prog = progressoMap[moduloAtivo.id]
              var done = prog && prog.concluido_em
              return (
                <div>
                  {emb
                    ? (
                      <div style={{ background: '#000', aspectRatio: '16/9', width: '100%', maxHeight: '60vh' }}>
                        <iframe
                          src={emb}
                          title={moduloAtivo.nome}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          style={{ width: '100%', height: '100%', border: 'none' }}
                        />
                      </div>
                    )
                    : (
                      <div style={{ padding: 40, textAlign: 'center', background: '#0d0b06', color: C.text3, fontSize: 14 }}>
                        (Este módulo ainda não tem vídeo publicado)
                      </div>
                    )
                  }
                  <div style={{ padding: '26px 32px', maxWidth: 880 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 8 }}>{moduloAtivo.nome}</div>
                    {moduloAtivo.descricao && <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.7, marginBottom: 20 }}>{moduloAtivo.descricao}</div>}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {done
                        ? <button style={{ ...S.btnGhost, color: '#4ade80', borderColor: '#14532d' }} onClick={function(){ desmarcarConcluido(moduloAtivo.id) }}>✓ Concluído (desmarcar)</button>
                        : <button style={S.btnG} onClick={function(){ marcarConcluido(moduloAtivo.id) }}>Marcar como concluído</button>
                      }
                      {moduloAtivo.material_url && (
                        <a href={moduloAtivo.material_url} target="_blank" rel="noreferrer"
                          style={{ ...S.btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          📎 Baixar material
                        </a>
                      )}
                    </div>
                    {prog && prog.concluido_em && <div style={{ marginTop: 14, fontSize: 11, color: C.text3 }}>Concluído em {fmtDate(prog.concluido_em)}</div>}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
