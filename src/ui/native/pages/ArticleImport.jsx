import { useDashboardLocation } from '../dashboard-state';
import { useUnsavedChanges } from '../NavigationGuard';
import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../transport';
import { Field, Feedback } from './forms';
import SecretSteps from '../setup-help/SecretSteps';
import { importGuides } from './knowledge/import-guides';
import './knowledge/knowledge.css';

const title = name => name[0].toUpperCase() + name.slice(1);

/** One provider's import: what it needs and how to get each value, shown before anything is submitted. */
function Requirements({ guide, requirements }) {
 const missing = requirements?.secrets.filter(secret => !secret.set) || [];
 return <section className="knowledge-import-needs" aria-label="What this import needs">
  <h3 className="knowledge-website-title">What this import needs</h3>
  <ul>{guide.secrets.map(secret => {
   const set = requirements?.secrets.find(item => item.name === secret.name)?.set;
   return <li key={secret.name} data-secret={secret.name}><span className={`h2h-chip${set ? '' : ' h2h-chip--muted'}`}>{set === undefined ? 'Checking' : set ? 'Set' : 'Not set'}</span> <code>{secret.name}</code>: {secret.what} {secret.how}</li>;
  })}</ul>
  {missing.length > 0 && <><p>These are installation secrets, so they are added to HappyToHelp itself, not typed here:</p><SecretSteps installation={requirements.installation} values={missing.map(({ name }) => ({ name, example: guide.secrets.find(secret => secret.name === name).example }))}/></>}
 </section>;
}

export default function ArticleImport({ projectId }) {
 const {markDirty,markSaved}=useUnsavedChanges();
 const routeLocation=useDashboardLocation();
 const initial=routeLocation.pathname.split('/')[5];
 const [platform,setPlatform]=useState(importGuides[initial]?initial:null),[subdomain,setSubdomain]=useState(''),[error,setError]=useState(null),[job,setJob]=useState(null),[busy,setBusy]=useState(false),[requirements,setRequirements]=useState(null);
 useEffect(()=>{setRequirements(null);if(platform&&!importGuides[platform].moveIn)nativeRequest(`/api/knowledge/${projectId}/import/${platform}`).then(setRequirements).catch(e=>setError({message:e.message}));},[projectId,platform]);
 const guide=platform&&importGuides[platform],ready=requirements?.secrets.every(secret=>secret.set);
 const submit=async event=>{event.preventDefault();setError(null);setBusy(true);try{setJob(await nativeRequest(`/api/knowledge/${projectId}/import/${platform}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subdomain})}));markSaved();}catch(error){setError({message:error.message,field:error.data?.field});}finally{setBusy(false);}};
 const refresh=async()=>{setBusy(true);try{setJob(await nativeRequest(`/api/knowledge/${projectId}/imports/${job.id}`));}catch(error){setError({message:error.message});}finally{setBusy(false);}};
 return <div className="knowledge-form"><Feedback error={error&&!error.field?error.message:''}/>{!platform?<><p className="knowledge-import-intro">Please choose which helpdesk you would like to import help articles from.</p><div className="knowledge-import-options">{Object.keys(importGuides).map(name=><button className="btn btn-white" key={name} onClick={()=>setPlatform(name)}>{title(name)}</button>)}</div></>:<><div className="mb-4"><button className="btn btn-link p-0" onClick={()=>{setPlatform(null);setJob(null);setError(null);}}>‹ Choose another helpdesk</button></div><form onSubmit={submit}><h2 className="knowledge-website-title">Import articles from {title(platform)}</h2><p className="settings-note">{guide.intro}</p>{guide.moveIn?<a className="btn btn-primary" href={`/projects/${projectId}/move-in`}>Open Move in</a>:<><Requirements guide={guide} requirements={requirements}/>{guide.subdomain&&<Field name="subdomain" label="Subdomain" hint={guide.subdomain} error={error?.field==='subdomain'?error.message:''} value={subdomain} onChange={(_,value)=>{markDirty();setSubdomain(value);setError(null);}} required/>}{error?.field==='credentials'&&<div className="invalid-feedback d-block" role="alert">{error.message}</div>}<button className="btn btn-primary" disabled={busy||Boolean(job)||!ready}>{busy?'Submitting…':'Import'}</button>{requirements&&!ready&&<p className="settings-note">Import is available once every value above shows Set. Reload this page after adding them.</p>}</>}</form></>}{job&&<section className="mt-4"><h2 className="knowledge-website-title">Import progress</h2><p role="status">{job.status}</p>{job.error&&<p role="alert">{job.error}</p>}<p>Articles: {job.articles??'Not recorded'} · Categories: {job.categories??'Not recorded'}</p><button className="btn btn-white" disabled={busy} onClick={refresh}>Refresh status</button></section>}</div>;
}
