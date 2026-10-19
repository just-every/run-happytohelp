import { useNavigationGuard } from './NavigationGuard';
import { useMobileNavigation } from './MobileNavigation';
import { invalidateDashboardSession, useDashboardLocation } from './dashboard-state';
import { Link, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { nativeRequest } from './transport';
import AdminNavigation from './AdminNavigation';
import WorkspaceSidebarArtwork from './WorkspaceSidebarArtwork';
import NavigationMore from './NavigationMore';
import { onSettingsDestination, pathIsWithin } from './settings-destinations';
import { BrandLockup } from '../homepage/BrandLockup';
import { DEFAULT_WORKSPACE_COLOUR } from '../../modules/management/workspace-colour';
import React, { useEffect, useRef, useState } from 'react';

function AccountMenu({ agent, desktop = false, showAdmin = false }) {
    const {confirmNavigation}=useNavigationGuard();
    const router=useRouter(), navigate=useNavigate(), pathname=useDashboardLocation().pathname;
    useEffect(()=>setOpen(false),[pathname]);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState('');
    const menu = useRef(null);
    const toggle = useRef(null);
    useEffect(()=>{const close=e=>{if(e.type==='keydown'&&e.key==='Escape'){if(open){e.preventDefault();setOpen(false);toggle.current?.focus();}}else if(!menu.current?.contains(e.target))setOpen(false);};document.addEventListener('click',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('click',close);document.removeEventListener('keydown',close);};},[open]);
    return <div ref={menu} className={`navbar-account-menu ${desktop ? 'dropup' : ''}`}>
        <button ref={toggle} type="button" className="native-profile-toggle" aria-label="Account menu" aria-expanded={open} onClick={()=>setOpen(!open)}>
            <span className="native-profile-avatar">{agent.avatar_url ? <img src={agent.avatar_url} alt=""/> : agent.name?.slice(0,1)}</span>
            {desktop && <><span className="navbar-profile-name">{agent.name}</span><i className="fe fe-chevron-up" aria-hidden="true"/></>}
        </button>
        {open && <div className="dropdown-menu show native-account-dropdown"><Link className="dropdown-item" to="/users/profile">Profile</Link>{showAdmin&&<Link className="dropdown-item" to="/admin">Admin</Link>}<button className="dropdown-item" onClick={async()=>{if(!await confirmNavigation())return;try {setError('');await nativeRequest('/api/identity/session',{method:'DELETE'});await invalidateDashboardSession(router);await navigate({to:'/login',replace:true,ignoreBlocker:true});} catch(failure) {setError(failure.message);}}}>Sign out</button>{error && <p className="px-3 mb-1 text-danger" role="alert">{error}</p>}</div>}
    </div>;
}

export default function Navigation({ settings }) {
    const {confirmNavigation}=useNavigationGuard();
    const pathname = useDashboardLocation().pathname;
    // Which row is current follows the router's own location, as each link's own active state does, so the two never disagree while a page loads.
    const here = useLocation({select:location=>location.pathname});
    const navigate=useNavigate();
    const [switchError,setSwitchError]=useState(''),[switching,setSwitching]=useState(false);
    const {open, setOpen} = useMobileNavigation();
    const [workspaceOpen, setWorkspaceOpen] = useState(false);
    // Only the Global Inbox has a Settings disclosure (one link per project, closed until asked); a project's Settings is one row.
    const [settingsOpen,setSettingsOpen] = useState(false);
    const nav = useRef(null);
    const workspaceToggle = useRef(null);
    const navigationToggle = useRef(null);
    useEffect(()=>{setOpen(false);setWorkspaceOpen(false);},[pathname]);
    useEffect(()=>{const close = e=>{if(e.key==='Escape'){if(workspaceOpen){e.preventDefault();setWorkspaceOpen(false);workspaceToggle.current?.focus();}else if(open){e.preventDefault();setOpen(false);navigationToggle.current?.focus();}}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[open,workspaceOpen]);
    useEffect(()=>{const close=e=>{if(nav.current && !nav.current.contains(e.target))setWorkspaceOpen(false);};document.addEventListener('click',close);return()=>document.removeEventListener('click',close);},[]);
    // The primary list and the Global Inbox's Settings list each scroll on short viewports: keep the current page's link fully visible inside its own box.
    useEffect(()=>{let live=true;const reveal=()=>{if(!live)return;for(const box of nav.current?.querySelectorAll('.navbar-scroll, #sidebarSettings')||[]){const item=box.querySelector('.nav-link.active');if(!item||!box.clientHeight)continue;const frame=box.getBoundingClientRect(),link=item.getBoundingClientRect();if(link.bottom>frame.bottom)box.scrollTop+=link.bottom-frame.bottom+8;else if(link.top<frame.top)box.scrollTop-=frame.top-link.top+8;}};reveal();document.fonts?.ready.then(reveal);return()=>{live=false};},[here,open,settingsOpen]);
    const project = settings.project?.id || Object.keys(settings.projects || {})[0];
    const base = project ? `/projects/${project}` : '';
    const workspaceName = settings.projectUnavailable ? 'Workspace unavailable' : settings.isGlobalInbox ? 'Global Inbox' : settings.project?.name;
    const brand = !settings.isGlobalInbox && (settings.project?.brand_image_url || settings.project?.avatar_url);
    // A row is current on its own path and on pages that render the same screen.
    const primaryActive = path => path==='articles' ? ['articles','datasets','categories','training-runs'].some(section=>pathIsWithin(here,`${base}/${section}`)) : path==='local-agent' ? pathIsWithin(here,`${base}/${path}`)||pathIsWithin(here,'/local-agent/authorize') : pathIsWithin(here,`${base}/${path}`);
    const inboxActive = here.includes('conversations') || here==='/';
    const current = on => on ? 'page' : undefined;
    const projectRows = [['Setup','activation','check-square'],['Knowledge','articles','book-open'],['AI','ais','cpu'],['Contacts','contacts','users'],['Companies','companies','briefcase']];
    const moreRows = [['Local computers','local-agent'],['Reports','reports'],['Insights','insights']].map(([label,path])=>({label,to:`${base}/${path}`,current:primaryActive(path)}));
    const settingsActive = !settings.isGlobalInbox && onSettingsDestination(here,base);
    const switchWorkspace = async id=>{if(switching||!await confirmNavigation())return;setSwitching(true);setSwitchError('');try{if(id)await nativeRequest('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:id})});await navigate({to:id?`/projects/${id}/conversations`:'/conversations',ignoreBlocker:true});}catch(error){setSwitchError(error.message);}finally{setSwitching(false);}};
    if (settings.isPlatformAdmin && (pathname === '/admin' || pathname.startsWith('/admin/'))) return <AdminNavigation agent={settings.currentAgent} AccountMenu={AccountMenu}/>;
    return <nav ref={nav} className="navbar navbar-vertical fixed-left navbar-expand-xl navbar-light navbar-refined native-shell" id="sidebar" aria-label="Main navigation"><div className="container-fluid">
        <button ref={navigationToggle} className="navbar-toggler" type="button" aria-controls="sidebarCollapse" aria-label="Toggle navigation" aria-expanded={open} onClick={()=>setOpen(!open)}><span className="navbar-toggler-icon" /></button>
        <div className="navbar-lockup"><BrandLockup home={settings.isGlobalInbox ? '/conversations' : `${base}/conversations`} as={Link} named/></div>
        <div className="navbar-workspace"><button ref={workspaceToggle} className="navbar-workspace-toggle" type="button" aria-label={`Switch workspace: ${workspaceName}`} aria-expanded={workspaceOpen} onClick={()=>setWorkspaceOpen(!workspaceOpen)}>{brand && <img className="navbar-workspace-brand" src={brand} alt=""/>}<span className="navbar-workspace-copy"><span className="navbar-workspace-name">{workspaceName}</span></span><i className="fe fe-chevron-down" aria-hidden="true"/></button>
        {workspaceOpen && <ul className="dropdown-menu navbar-workspace-menu show"><li><h6 className="dropdown-header">Your workspaces</h6></li>{Object.values(settings.projects || {}).map(p=><li key={p.id}><button className={`dropdown-item ${!settings.isGlobalInbox && p.id === project ? 'active' : ''}`} disabled={switching} onClick={()=>switchWorkspace(p.id)}><span>{p.name}</span><span className="navbar-workspace-swatch" style={{background:p.primary_color||DEFAULT_WORKSPACE_COLOUR}} aria-hidden="true"/></button></li>)}<li><hr className="dropdown-divider"/></li><li><button className={`dropdown-item ${settings.isGlobalInbox && !settings.projectUnavailable ? 'active' : ''}`} disabled={switching} onClick={()=>switchWorkspace('')}>Global Inbox</button></li></ul>}{switchError&&<p className="text-danger" role="alert">{switchError}</p>}</div>
        <div className="navbar-user d-xl-none"><AccountMenu agent={settings.currentAgent} showAdmin={settings.isPlatformAdmin}/></div>
        <div className={`navbar-collapse collapse ${open ? 'show' : ''}`} id="sidebarCollapse"><div className="navbar-scroll"><ul className="navbar-nav navbar-nav-primary" data-testid="nav-primary">
            <li className="nav-item nav-item-inbox"><Link className={`nav-link ${inboxActive ? 'active' : ''}`} aria-current={current(inboxActive)} to={settings.isGlobalInbox ? '/conversations' : `${base}/conversations`}><i className="fe fe-inbox" aria-hidden="true"/><span className="navbar-link-label">Inbox</span><span id="navigation-inbox-unread" hidden><span className="navbar-unread-count" data-testid="count-disc"/></span></Link></li>
            {settings.isGlobalInbox && <li className="nav-item"><details className="native-global-contacts"><summary><i className="fe fe-users" aria-hidden="true"/><span>Contacts</span><i className="fe fe-chevron-down" aria-hidden="true"/></summary><ul className="nav flex-column">{Object.values(settings.projects || {}).map(p=><li className="nav-item" key={p.id}><Link className="nav-link" to={`/projects/${p.id}/contacts`}>Contacts in {p.name}</Link></li>)}</ul></details></li>}
            {!settings.isGlobalInbox && projectRows.map(([label,path,icon])=><li className="nav-item" key={path}><Link className={`nav-link ${primaryActive(path) ? 'active' : ''}`} aria-current={current(primaryActive(path))} to={`${base}/${path}`}><i className={`fe fe-${icon}`} aria-hidden="true"/><span className="navbar-link-label">{label}</span></Link></li>)}
            {!settings.isGlobalInbox && <NavigationMore links={moreRows}/>}</ul>
            <WorkspaceSidebarArtwork project={settings.isGlobalInbox ? null : settings.project}/></div><div className="navbar-bottom"><ul className="navbar-nav navbar-nav-utility"><li className="nav-item">{settings.isGlobalInbox
                ? <><button className="nav-link navbar-settings-toggle" type="button" data-testid="nav-settings" aria-controls="sidebarSettings" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(!settingsOpen)}><i className="fe fe-settings" aria-hidden="true"/><span className="navbar-link-label">Settings</span><i className="fe fe-chevron-down navbar-settings-chevron" aria-hidden="true"/></button><div id="sidebarSettings" hidden={!settingsOpen}><ul className="nav nav-md flex-column" aria-label="Project settings">{Object.values(settings.projects || {}).map(p=><li className="nav-item" key={p.id}><Link className="nav-link" to={`/projects/${p.id}/edit`}>Settings for {p.name}</Link></li>)}</ul></div></>
                : <Link className={`nav-link ${settingsActive ? 'active' : ''}`} data-testid="nav-settings" aria-current={current(settingsActive)} to={`${base}/edit`}><i className="fe fe-settings" aria-hidden="true"/><span className="navbar-link-label">Settings</span></Link>}</li></ul></div>
        <div className="navbar-user d-none d-xl-flex" id="sidebarUser"><AccountMenu agent={settings.currentAgent} desktop showAdmin={settings.isPlatformAdmin}/></div></div>
    </div></nav>;
}
