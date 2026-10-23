import React, {useEffect, useState} from 'react';
import {Link} from '@tanstack/react-router';
import {nativeRequest} from '../transport';
import {useDashboardSettings} from '../dashboard-state';
import {Section} from './forms';

/** Reviewed associations are staff context. They never expand a customer's session. */
export default function ContactIdentityLinks({projectId, contactId}) {
 const settings=useDashboardSettings(), permitted=settings.projects?.[projectId]?.access?.permissions?.includes('contacts.manage');
 const [result,setResult]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  setResult(null);setError('');if(!permitted)return;
  const controller=new AbortController();
  nativeRequest(`/api/management/projects/${projectId}/contacts/${contactId}/identity-links`,{signal:controller.signal})
   .then(data=>{if(!controller.signal.aborted)setResult(data)})
   .catch(failure=>{if(!controller.signal.aborted)setError(failure.message)});
  return()=>controller.abort();
 },[projectId,contactId,permitted]);
 if(!permitted)return null;
 return <Section title="Possibly the same customer" description="Reviewed identity associations for staff. Each customer keeps their own access and conversation history.">
  {error&&<p role="alert">{error}</p>}
  {!result&&!error&&<p role="status">Loading reviewed associations…</p>}
  {result&&(result.links.length?<ul className="list-unstyled">{result.links.map(link=><li key={link.contact.id} className="mb-3">
   <Link to={`/projects/${projectId}/contacts/${link.contact.id}`}>{link.contact.name||link.contact.email||link.contact.external_id||'Customer record'}</Link>
   <p className="mb-1">Reviewed by {link.actor_name||'a former teammate'} · <time dateTime={new Date(link.created_at).toISOString()}>{new Date(link.created_at).toLocaleString()}</time></p>
   <p className="mb-0 text-break">Source and reason: {link.provenance}</p>
  </li>)}</ul>:<p>No reviewed identity associations.</p>)}
 </Section>;
}
