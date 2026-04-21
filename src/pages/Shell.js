import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import DashboardPage  from './DashboardPage'
import CRMPage        from './CRMPage'
import FinanceiroPage from './FinanceiroPage'
import EventosPage    from './EventosPage'
import RelatoriosPage from './RelatoriosPage'
import CheckinPage    from './CheckinPage'
import CursosPage     from './CursosPage'

var ROLE_LABELS = { admin:{label:'Administrador',color:'#c9a96e'}, comercial:{label:'Comercial',color:'#60a5fa'}, financeiro:{label:'Financeiro',color:'#4ade80'}, operacional:{label:'Operacional',color:'#b8a882'} }

export default function Shell() {
  var auth = useAuth()
  var [page, setPage] = useState('dashboard')
  var [col, setCol] = useState(false)

  var NAV = [
    {id:'dashboard',l:'Dashboard',   d:'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'},
    {id:'clientes',l:'Clientes',     d:'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857'},
    {id:'eventos',l:'Eventos',       d:'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'},
    {id:'checkin',l:'Check-in',      d:'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'},
    {id:'cursos',l:'Cursos',         d:'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13'},
  ]
  if (auth.canSeeFinanceiro) {
    NAV.push({id:'financeiro',l:'Financeiro', d:'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1'})
    NAV.push({id:'relatorios',l:'Relatorios',d:'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2'})
  }

  var ri = ROLE_LABELS[auth.role] || {label:'Usuario',color:'#b8a882'}
  var sw = col ? 64 : 220

  return (
    <div style={{display:'flex',height:'100vh',background:'#0a0900',fontFamily:'Inter,sans-serif',overflow:'hidden'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box} ::-webkit-scrollbar{width:6px;height:6px} ::-webkit-scrollbar-thumb{background:#2a2415;border-radius:3px} input:focus,select:focus,textarea:focus{border-color:#c9a96e!important;box-shadow:0 0 0 3px rgba(201,169,110,0.12)}`}</style>
      <aside style={{width:sw,minWidth:sw,background:'#0d0b06',borderRight:'1px solid #2a2415',display:'flex',flexDirection:'column',transition:'width .25s',overflow:'hidden'}}>
        <div style={{padding:'16px 14px',borderBottom:'1px solid #2a2415',display:'flex',alignItems:'center',justifyContent:col?'center':'space-between',minHeight:65}}>
          {!col&&<div><div style={{fontSize:16,fontWeight:800,color:'#c9a96e',letterSpacing:'-0.02em',whiteSpace:'nowrap'}}>Outliers CRM</div><div style={{fontSize:10,color:'#7a6a4a',marginTop:1,textTransform:'uppercase',letterSpacing:'0.1em'}}>Paradigma</div></div>}
          <button onClick={function(){setCol(function(p){return !p})}} style={{background:'none',border:'none',color:'#7a6a4a',cursor:'pointer',padding:4,display:'flex',alignItems:'center',flexShrink:0}}>
            <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={col?'M9 5l7 7-7 7':'M15 19l-7-7 7-7'}/></svg>
          </button>
        </div>
        <nav style={{flex:1,padding:'12px 8px',display:'flex',flexDirection:'column',gap:3,overflowY:'auto'}}>
          {NAV.map(function(n){
            var ac=page===n.id
            return (
              <button key={n.id} onClick={function(){setPage(n.id)}} title={col?n.l:undefined}
                style={{display:'flex',alignItems:'center',gap:10,padding:col?'12px 0':'11px 12px',justifyContent:col?'center':'flex-start',width:'100%',background:ac?'#1c1810':'none',border:ac?'1px solid #2a2415':'1px solid transparent',borderRadius:9,color:ac?'#c9a96e':'#7a6a4a',cursor:'pointer',fontFamily:'Inter,sans-serif',fontSize:14,fontWeight:ac?600:400,transition:'all .15s',overflow:'hidden',whiteSpace:'nowrap'}}>
                <svg width={20} height={20} fill="none" stroke={ac?'#c9a96e':'#7a6a4a'} strokeWidth={1.8} viewBox="0 0 24 24" style={{flexShrink:0}}><path strokeLinecap="round" strokeLinejoin="round" d={n.d}/></svg>
                {!col&&<span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{n.l}</span>}
                {ac&&!col&&<div style={{marginLeft:'auto',width:6,height:6,borderRadius:'50%',background:'#c9a96e',flexShrink:0}}/>}
              </button>
            )
          })}
        </nav>
        <div style={{padding:'12px 10px',borderTop:'1px solid #2a2415',display:'flex',alignItems:'center',gap:10,minHeight:65}}>
          <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(135deg,#c9a96e,#a07840)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,color:'#0a0900',flexShrink:0}}>
            {auth.profile?auth.profile.nome.charAt(0).toUpperCase():'?'}
          </div>
          {!col&&auth.profile&&<div style={{flex:1,overflow:'hidden'}}><div style={{fontSize:13,fontWeight:600,color:'#f0ead8',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{auth.profile.nome}</div><div style={{fontSize:11,color:ri.color,marginTop:1,fontWeight:500}}>{ri.label}</div></div>}
          {!col&&<button onClick={auth.signOut} style={{background:'none',border:'none',color:'#7a6a4a',cursor:'pointer',padding:4,display:'flex',alignItems:'center'}} title="Sair"><svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg></button>}
        </div>
      </aside>
      <main style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        {page==='dashboard'&&<DashboardPage onNav={setPage}/>}
        {page==='clientes'&&<CRMPage/>}
        {page==='financeiro'&&<FinanceiroPage/>}
        {page==='eventos'&&<EventosPage/>}
        {page==='checkin'&&<CheckinPage/>}
        {page==='cursos'&&<CursosPage/>}
        {page==='relatorios'&&<RelatoriosPage/>}
      </main>
    </div>
  )
}
