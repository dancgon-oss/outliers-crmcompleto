import { AuthProvider, useAuth } from './lib/AuthContext'
import LoginPage from './pages/LoginPage'
import Shell from './pages/Shell'

function Root() {
  var auth = useAuth()
  if (auth.loading) {
    return (
      <div style={{ background:'#0a0900',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center' }}>
        <div style={{ fontFamily:'monospace',color:'#c9a96e',fontSize:13,letterSpacing:'0.15em' }}>CARREGANDO...</div>
      </div>
    )
  }
  return auth.user ? <Shell /> : <LoginPage />
}

export default function App() {
  return <AuthProvider><Root /></AuthProvider>
}
