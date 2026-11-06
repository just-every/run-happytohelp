import { useUnsavedChanges } from '../NavigationGuard';
import { useNavigate } from '@tanstack/react-router';
import { useDashboardLocation } from '../dashboard-state';
import { Link } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../transport';
import {PageHeaderActions} from '../PageHeader';
import './project-parity.css';
import { Field, Section, Feedback } from './forms';
import { tooltip } from '../../../modules/tooltip/tooltip';
// The account's own role in each project: an owner reads Owner, not Admin.
const roleLabels={owner:'Owner',admin:'Admin'};
export default function ProjectsPage() {
 const {markDirty,markSaved}=useUnsavedChanges();

    const navigate=useNavigate(),routeLocation=useDashboardLocation();

    const [items,setItems]=useState([]),[draft,setDraft]=useState({name:'',website:'',allowed_origin:''}),[error,setError]=useState('');
    const creating=routeLocation.pathname.endsWith('/create');
    useEffect(()=>{nativeRequest('/api/management/projects').then(r=>setItems(r.data)).catch(e=>setError(e.message));},[]);
    const change=(name,value)=>{markDirty();setDraft(d=>({...d,[name]:value}));};
    const submit=async e=>{e.preventDefault();try{const created=await nativeRequest('/api/management/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});markSaved();await nativeRequest('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:created.id})});await navigate({to:`/projects/${created.id}/activation`});}catch(e){setError(e.message);}};
    return <><Feedback error={error}/>{creating?<div className="workspace-settings"><form onSubmit={submit}><Section title="Project details"><div className="settings-grid"><Field name="name" label="Name" value={draft.name} onChange={change} required/><Field name="website" label="Website" type="url" value={draft.website} onChange={change} required/><Field name="allowed_origin" label="Widget website origin" type="url" value={draft.allowed_origin} onChange={change} required/></div></Section><button className="btn btn-primary">Create project</button></form></div>:<><PageHeaderActions><Link className="btn btn-primary" to="/projects/create">Create Project</Link></PageHeaderActions><table className="project-list-table"><thead><tr><th>Name</th><th>Role</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{items.map(project=><tr key={project.id}><td><Link id={`project-${project.id}-name`} to={`/projects/${project.id}/conversations`}>{project.name}</Link> {Boolean(project.is_primary)&&<span className="project-list-badge">Primary</span>}</td><td><span className="project-list-badge">{roleLabels[project.role]||project.role}</span></td><td><details className="project-list-menu"><summary {...tooltip('More actions',{describedBy:`project-${project.id}-name`})}><span aria-hidden="true">⋮</span></summary><div><Link to={`/projects/${project.id}/edit`}>Settings</Link><Link to={`/projects/${project.id}/conversations`}>Open project</Link></div></details></td></tr>)}</tbody></table></>}</>;
}
