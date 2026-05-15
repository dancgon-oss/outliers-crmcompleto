import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import FinanceiroPage   from './FinanceiroPage'
import ComissoesPage    from './ComissoesPage'
import ContasPagarPage  from './ContasPagarPage'
import DREPage          from './DREPage'

function Tab({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? '#141209' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #c9a96e' : '2px solid transparent',
        color: active ? '#c9a96e' : '#7a6a4a',
        padding: '12px 18px',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'Inter,sans-serif',
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: -1,
      }}>
      {icon && <span>{icon}</span>}
      {children}
    </button>
  )
}

export default function FinanceiroHub() {
  var auth = useAuth()
  var [aba, setAba] = useState('clientes')

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#0a0900', overflow:'hidden' }}>
      <div style={{
        display:'flex', borderBottom:'1px solid #2a2415',
        background:'#0d0b06', padding:'0 16px', flexShrink:0
      }}>
        <Tab active={aba==='clientes'}  onClick={function(){ setAba('clientes') }}  icon="💰">Clientes</Tab>
        {(auth.canSeeFinanceiro || auth.isComercial) && (
          <Tab active={aba==='comissoes'} onClick={function(){ setAba('comissoes') }} icon="🤝">Comissões</Tab>
        )}
        {auth.canSeeFinanceiro && (
          <Tab active={aba==='contas'} onClick={function(){ setAba('contas') }} icon="📄">Contas a Pagar</Tab>
        )}
        {auth.canSeeFinanceiro && (
          <Tab active={aba==='dre'} onClick={function(){ setAba('dre') }} icon="📊">DRE</Tab>
        )}
      </div>

      <div style={{ flex:1, overflow:'hidden' }}>
        {aba === 'clientes'  && <FinanceiroPage />}
        {aba === 'comissoes' && <ComissoesPage perfilUsuario={auth.role} usuarioId={auth.profile && auth.profile.id} />}
        {aba === 'contas'    && <ContasPagarPage origem="Outliers" />}
        {aba === 'dre'       && <DREPage />}
      </div>
    </div>
  )
}
