import { AuthProvider, useAuth } from './lib/AuthContext'
import LoginPage from './pages/LoginPage'
import Shell from './pages/Shell'
import PortalAluno from './pages/PortalAluno'

function Root() {
  var auth = useAuth()
  if (auth.loading) {
    return (
      <div style={{ background:'#0a0900',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ fontFamily:'monospace',color:'#c9a96e',fontSize:13,letterSpacing:'0.15em' }}>CARREGANDO...</div>
      </div>
    )
  }
  if (!auth.user) return <LoginPage />
  if (auth.isAluno) return <PortalAluno />
  return <Shell />
}

export default function App() {
  return <AuthProvider><Root /></AuthProvider>
}
