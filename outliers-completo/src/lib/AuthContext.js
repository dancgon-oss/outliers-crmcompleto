import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

var Ctx = createContext({})

export function AuthProvider({ children }) {
  var [user, setUser] = useState(null)
  var [profile, setProfile] = useState(null)
  var [loading, setLoading] = useState(true)

  useEffect(function() {
    supabase.auth.getSession().then(function(r) {
      var session = r.data.session
      setUser(session ? session.user : null)
      if (session && session.user) fetchProfile(session.user.id)
      else setLoading(false)
    })
    var sub = supabase.auth.onAuthStateChange(function(_e, session) {
      setUser(session ? session.user : null)
      if (session && session.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return function() { sub.data.subscription.unsubscribe() }
  }, [])

  async function fetchProfile(uid) {
    var r = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(r.data)
    setLoading(false)
  }

  var role = profile ? profile.role : null

  return (
    <Ctx.Provider value={{
      user, profile, loading, role,
      // Permissões por perfil
      isAdmin:      role === 'admin',
      isComercial:  role === 'comercial',
      isFinanceiro: role === 'financeiro',
      isOperacional:role === 'operacional',
      isAluno:      role === 'aluno',
      isStaff:      role === 'admin' || role === 'comercial' || role === 'financeiro' || role === 'operacional',
      // Helpers de acesso
      canSeeFinanceiro: role === 'admin' || role === 'comercial' || role === 'financeiro',
      canEditClientes:  role === 'admin' || role === 'comercial' || role === 'financeiro',
      canDeleteClientes:role === 'admin' || role === 'comercial',
      canManageEventos: role === 'admin' || role === 'comercial',
      canManageCursos:  role === 'admin' || role === 'comercial',
      canCheckin:       role !== 'aluno',
      canCadastrarParticipantes: role !== 'aluno',
      signIn:  function(e, p) { return supabase.auth.signInWithPassword({ email: e, password: p }) },
      signOut: function() { return supabase.auth.signOut() },
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
