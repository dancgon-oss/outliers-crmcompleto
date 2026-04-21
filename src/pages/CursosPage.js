import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fmt, C, INPUT_S, BTN_PRIMARY, BTN_GHOST, LABEL_S, CARD_S, OVERLAY_S, MODAL_S } from '../lib/ui'

var CAT_COLORS = {
  Imersao:  { bg: '#1e3a5f33', text: '#60a5fa', border: '#1e3a5f' },
  Outliers: { bg: '#c9a96e22', text: '#c9a96e', border: '#a07840' },
  Avulso:   { bg: '#2a1b4f33', text: '#a78bfa', border: '#2a1b4f' },
}

var EMPTY = { nome: '', descricao: '', preco_padrao: '', categoria: 'Outliers', ativo: true }

export default function CursosPage() {
  var auth = useAuth()
  var [cursos, setCursos] = useState([])
  var [loading, setLoading] = useState(true)
  var [modal, setModal] = useState(null)   // null | 'novo' | curso obj
  var [form, setForm] = useState(EMPTY)
  var [saving, setSaving] = useState(false)
  var [erro, setErro] = useState('')
  var [search, setSearch] = useState('')
  var [filtCat, setFiltCat] = useState('Todos')
  var [confirmDel, setConfirmDel] = useState(null)

  useEffect(function() { carregar() }, [])

  async function carregar() {
    setLoading(true)
    var { data } = await supabase.from('cursos').select('*').order('ordem').order('nome')
    setCursos(data || [])
    setLoading(false)
  }

  function abrirNovo() {
    setForm(EMPTY)
    setErro('')
    setModal('novo')
  }

  function abrirEditar(c) {
    setForm({ nome: c.nome, descricao: c.descricao || '', preco_padrao: c.preco_padrao, categoria: c.categoria, ativo: c.ativo })
    setErro('')
    setModal(c)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome obrigatório.'); return }
    if (form.preco_padrao === '' || isNaN(Number(form.preco_padrao))) { setErro('Preço inválido.'); return }
    setSaving(true)
    setErro('')
    var payload = { nome: form.nome.trim(), descricao: form.descricao.trim() || null, preco_padrao: Number(form.preco_padrao), categoria: form.categoria, ativo: form.ativo }
    if (modal === 'novo') {
      var { error } = await supabase.from('cursos').insert(payload)
      if (error) { setErro(error.message); setSaving(false); return }
    } else {
      var { error: e2 } = await supabase.from('cursos').update(payload).eq('id', modal.id)
      if (e2) { setErro(e2.message); setSaving(false); return }
    }
    setSaving(false)
    setModal(null)
    carregar()
  }

  async function toggleAtivo(c) {
    await supabase.from('cursos').update({ ativo: !c.ativo }).eq('id', c.id)
    carregar()
  }

  async function deletar(c) {
    await supabase.from('cursos').delete().eq('id', c.id)
    setConfirmDel(null)
    carregar()
  }

  var canEdit = auth.isAdmin || auth.isComercial

  var filtrados = cursos.filter(function(c) {
    var ms = search ? (c.nome.toLowerCase().includes(search.toLowerCase()) || (c.descricao||'').toLowerCase().includes(search.toLowerCase())) : true
    var mc = filtCat === 'Todos' || c.categoria === filtCat
    return ms && mc
  })

  var totalCatalogo = cursos.filter(function(c){return c.ativo}).reduce(function(s,c){return s+Number(c.preco_padrao)},0)

  var S = {
    inp: INPUT_S,
    btnG: BTN_PRIMARY,
    btnGhost: BTN_GHOST,
    lbl: LABEL_S,
    card: CARD_S,
    overlay: OVERLAY_S,
    modal: MODAL_S,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, fontFamily: 'Inter, sans-serif', color: C.text }}>

      {/* HEADER */}
      <div style={{ padding: '22px 28px 18px', borderBottom: '1px solid ' + C.border, background: '#0d0b06', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em' }}>Catálogo de Cursos</div>
          <div style={{ fontSize: 14, color: C.text3, marginTop: 4 }}>{cursos.filter(function(c){return c.ativo}).length} cursos ativos · Valor total: {fmt(totalCatalogo)}</div>
        </div>
        {canEdit && (
          <button style={S.btnG} onClick={abrirNovo}>+ Novo Curso</button>
        )}
      </div>

      {/* FILTROS */}
      <div style={{ padding: '14px 28px', borderBottom: '1px solid ' + C.border, background: '#0d0b06', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...S.inp, flex: 1, minWidth: 200 }} placeholder="Buscar curso..." value={search} onChange={function(e){setSearch(e.target.value)}} />
        {['Todos', 'Imersao', 'Outliers', 'Avulso'].map(function(cat) {
          return (
            <button key={cat} onClick={function(){setFiltCat(cat)}}
              style={{ padding: '8px 16px', borderRadius: 8, border: filtCat === cat ? '1px solid #c9a96e' : '1px solid ' + C.border, background: filtCat === cat ? '#1c1810' : 'none', color: filtCat === cat ? '#c9a96e' : C.text3, fontSize: 14, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: filtCat === cat ? 600 : 400, transition: 'all .15s' }}>
              {cat === 'Imersao' ? 'Imersão' : cat}
            </button>
          )
        })}
      </div>

      {/* LISTA */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {loading && <div style={{ color: C.text3, textAlign: 'center', padding: 40, fontSize: 15 }}>Carregando...</div>}

        {!loading && filtrados.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: C.text3, fontSize: 15 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div>Nenhum curso encontrado.</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {filtrados.map(function(c) {
            var catC = CAT_COLORS[c.categoria] || CAT_COLORS['Avulso']
            return (
              <div key={c.id}
                style={{ ...S.card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12, opacity: c.ativo ? 1 : 0.55, position: 'relative', transition: 'border-color .15s, opacity .2s', cursor: canEdit ? 'pointer' : 'default' }}
                onClick={canEdit ? function(){abrirEditar(c)} : undefined}>

                {/* Categoria + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: catC.text, background: catC.bg, border: '1px solid ' + catC.border, padding: '3px 9px', borderRadius: 20, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {c.categoria === 'Imersao' ? 'Imersão' : c.categoria}
                  </span>
                  {!c.ativo && <span style={{ fontSize: 11, color: C.text3, background: '#1c1c1e33', border: '1px solid #3a3a3e', padding: '3px 9px', borderRadius: 20 }}>Inativo</span>}
                </div>

                {/* Nome */}
                <div style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{c.nome}</div>

                {/* Descrição */}
                {c.descricao && <div style={{ fontSize: 14, color: C.text3, lineHeight: 1.6 }}>{c.descricao}</div>}

                {/* Preço */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Preço padrão</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#c9a96e' }}>{c.preco_padrao > 0 ? fmt(c.preco_padrao) : 'Incluso'}</div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6 }} onClick={function(e){e.stopPropagation()}}>
                      <button onClick={function(){toggleAtivo(c)}}
                        style={{ ...S.btnGhost, padding: '6px 12px', fontSize: 12 }}>
                        {c.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      {auth.isAdmin && (
                        <button onClick={function(){setConfirmDel(c)}}
                          style={{ ...S.btnGhost, padding: '6px 10px', fontSize: 12, color: '#e05252', borderColor: '#7f1d1d' }}>
                          🗑
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Edit hint */}
                {canEdit && (
                  <div style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderRadius: 6, background: '#1c1810', border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
                    <svg width={14} height={14} fill="none" stroke={C.text3} strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* MODAL CRIAR/EDITAR */}
      {modal && (
        <div style={S.overlay} onClick={function(){if(!saving){setModal(null)}}}>
          <div style={{ ...S.modal, width: 520 }} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              {modal === 'novo' ? 'Novo Curso' : 'Editar Curso'}
            </div>
            <div style={{ fontSize: 14, color: C.text3, marginBottom: 24 }}>
              {modal === 'novo' ? 'Adicione um novo produto ao catálogo.' : 'Edite as informações do curso.'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={S.lbl}>Nome do Curso *</label>
                <input style={S.inp} value={form.nome} onChange={function(e){setForm(function(p){return {...p,nome:e.target.value}})}} placeholder="Ex: PQV — Qualificação de Vendas" autoFocus />
              </div>

              <div>
                <label style={S.lbl}>Descrição</label>
                <textarea style={{ ...S.inp, height: 80, resize: 'vertical' }} value={form.descricao} onChange={function(e){setForm(function(p){return {...p,descricao:e.target.value}})}} placeholder="Breve descrição do curso..." />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={S.lbl}>Preço Padrão (R$) *</label>
                  <input style={S.inp} type="number" value={form.preco_padrao} onChange={function(e){setForm(function(p){return {...p,preco_padrao:e.target.value}})}} placeholder="0.00" min="0" step="0.01" />
                </div>
                <div>
                  <label style={S.lbl}>Categoria</label>
                  <select style={S.inp} value={form.categoria} onChange={function(e){setForm(function(p){return {...p,categoria:e.target.value}})}}>
                    <option value="Imersao">Imersão</option>
                    <option value="Outliers">Outliers</option>
                    <option value="Avulso">Avulso</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.ativo} onChange={function(e){setForm(function(p){return {...p,ativo:e.target.checked}})}} style={{ opacity: 0, width: 0, height: 0 }} />
                  <div style={{ width: 40, height: 22, background: form.ativo ? '#c9a96e' : '#2a2415', borderRadius: 11, position: 'relative', transition: 'background .2s' }}>
                    <div style={{ position: 'absolute', top: 3, left: form.ativo ? 21 : 3, width: 16, height: 16, background: '#fff', borderRadius: '50%', transition: 'left .2s' }} />
                  </div>
                </label>
                <span style={{ fontSize: 15, color: C.text2 }}>Curso ativo (visível para vendas)</span>
              </div>
            </div>

            {erro && <div style={{ marginTop: 16, background: '#7f1d1d22', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', fontSize: 14, borderRadius: 8 }}>{erro}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
              <button style={S.btnGhost} onClick={function(){setModal(null)}} disabled={saving}>Cancelar</button>
              <button style={S.btnG} onClick={salvar} disabled={saving}>{saving ? 'Salvando...' : modal === 'novo' ? 'Criar Curso' : 'Salvar Alterações'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR EXCLUSÃO */}
      {confirmDel && (
        <div style={S.overlay} onClick={function(){setConfirmDel(null)}}>
          <div style={{ ...S.modal, width: 420, textAlign: 'center' }} onClick={function(e){e.stopPropagation()}}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>Excluir Curso?</div>
            <div style={{ fontSize: 14, color: C.text3, marginBottom: 24 }}>
              <strong style={{ color: C.text }}>{confirmDel.nome}</strong> será removido permanentemente. Esta ação não pode ser desfeita.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button style={S.btnGhost} onClick={function(){setConfirmDel(null)}}>Cancelar</button>
              <button style={{ ...S.btnG, background: '#e05252' }} onClick={function(){deletar(confirmDel)}}>Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
