import { AuthProvider, useAuth } from './lib/AuthContext'
import LoginPage from './pages/LoginPage'
import Shell from './pages/Shell'
import PortalAluno from './pages/PortalAluno'

// Quando o link do e-mail de recuperação chega, a URL tem `type=recovery`.
// Nesse caso forçamos LoginPage (modo reset) mesmo se uma sessão já existir,
// pra evitar entrar no Shell antes do usuário definir a nova senha.
function isRecoveryUrl() {
  if (typeof window === 'undefined') return false
  var h = window.location.hash || ''
  var s = window.location.search || ''
  return /type=recovery/.test(h) || /type=recovery/.test(s)
}

function Root() {
  var auth = useAuth()
  if (auth.loading) {
    return (
      <div style={{ background:'#0a0900',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ fontFamily:'monospace',color:'#c9a96e',fontSize:13,letterSpacing:'0.15em' }}>CARREGANDO...</div>
      </div>
    )
  }
  if (isRecoveryUrl()) return <LoginPage />
  if (!auth.user) return <LoginPage />
  if (auth.isAluno) return <PortalAluno />
  return <Shell />
}

export default function App() {
  return <AuthProvider><Root /></AuthProvider>
}
