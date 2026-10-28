import { useDashboardLocation } from './dashboard-state';
import { Link } from '@tanstack/react-router';
import React, { useState, useEffect } from 'react';
import { BrandMark } from '../homepage/BrandMark';
import { tooltip } from '../../modules/tooltip/tooltip';
const links = [['Projects','projects','briefcase'],['Datasets','datasets','database'],['Users','users','users'],['AI Defaults','ai_defaults','zap'],['AI Log','ai_logs','list'],['Connections','connections','link'],['Leads','leads','mail']];
export default function AdminNavigation({ agent, AccountMenu }) {
    const [open,setOpen] = useState(false);
    const pathname=useDashboardLocation().pathname;
    const section = pathname.split('/')[2] || 'projects';
    useEffect(()=>setOpen(false),[pathname]);
    return <nav className="navbar navbar-vertical fixed-left navbar-expand-xl navbar-light navbar-refined native-shell" id="sidebar" aria-label="Administration navigation"><div className="container-fluid">
        <button className="navbar-toggler" type="button" aria-controls="sidebarCollapse" aria-expanded={open} {...tooltip('Toggle navigation','right')} onClick={()=>setOpen(!open)}><span className="navbar-toggler-icon"/></button>
        <div className="navbar-workspace"><Link className="navbar-workspace-toggle" to="/conversations"><BrandMark /><span className="navbar-workspace-copy"><span className="navbar-workspace-label">HappyToHelp</span><span className="navbar-workspace-name">Administration</span></span></Link></div>
        <div className="navbar-user d-xl-none"><AccountMenu agent={agent} showAdmin/></div>
        <div className={`collapse navbar-collapse ${open ? 'show' : ''}`} id="sidebarCollapse"><div className="navbar-scroll"><ul className="navbar-nav navbar-nav-primary">{links.map(([label,path,icon])=><li className="nav-item" key={path}><Link className={`nav-link ${section===path ? 'active' : ''}`} to={`/admin/${path}`} aria-current={section===path ? 'page' : undefined}><i className={`fe fe-${icon}`} aria-hidden="true"/><span className="navbar-link-label">{label}</span></Link></li>)}</ul></div><div className="navbar-user d-none d-xl-flex" id="sidebarUser"><AccountMenu agent={agent} desktop showAdmin/></div></div>
    </div></nav>;
}
