import React,{useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../../transport';
import ConsentForm,{ConsentReview} from './ConsentForm';
import GrantStatus from './GrantStatus';
import {refusal} from './presentation';
import './rehearsal.css';

export default function DailyCopy({projectId}) {
 const [open,setOpen] = useState(false);
 return <details className="move-in-details rehearsal-panel" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Daily copy consent</summary>{open&&<DailyCopyPanel key={projectId} projectId={projectId}/>}</details>;
}

function DailyCopyPanel({projectId}) {
 const base = `/api/move-in/projects/${encodeURIComponent(projectId)}/rehearsals`;
 const [context,setContext] = useState(null),[error,setError] = useState(null),[busy,setBusy] = useState(false),[review,setReview] = useState(null),[credential,setCredential] = useState(null);
 const lifetime = useRef(null),field = useRef(null),pending = useRef(false),reading = useRef(false),readSequence = useRef(0);
 const load = async (signal,background=false) => {
  if(reading.current)return;
  reading.current=true;const sequence=++readSequence.current;
  try {const result=await nativeRequest(base,{signal});if(!signal.aborted&&sequence===readSequence.current){setContext(result.data);if(!background)setError(null);}}
  catch(error){if(!signal.aborted&&sequence===readSequence.current){setError(refusal(error));if(error.status===403){setContext(null);setCredential(null);setReview(null);}}}
  finally {reading.current=false;}
 };
 useEffect(()=>{
  const controller = new AbortController();lifetime.current=controller;load(controller.signal);
  // Refresh in place: open scope details, review and form values keep their state.
  const timer = setInterval(()=>{if(!pending.current)load(controller.signal,true);},5000);
  return ()=>{controller.abort();clearInterval(timer);if(field.current)field.current.value='';};
 },[base]);
 useEffect(()=>{if(credential&&context?.grants.some(grant=>grant.id===credential.grantId&&grant.state!=='active'))setCredential(null);},[context,credential]);
 useEffect(()=>{if(credential)field.current?.focus();},[credential]);
 const mutate = async (path,body,onResult) => {
  if(pending.current)return;
  const signal=lifetime.current.signal;pending.current=true;readSequence.current++;setBusy(true);setError(null);
  try {const result=await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});if(!signal.aborted){onResult(result.data);await load(signal);}}
  catch(error){if(!signal.aborted)setError(refusal(error));}
  finally {pending.current=false;if(!signal.aborted)setBusy(false);}
 };
 const grant = ()=>mutate(base,{originManifestSha256:review.adoption.manifestSha256,zendeskProjectId:review.connection.projectId,zendeskPullId:review.connection.pullId,copierId:review.copierId,expiresAt:review.expiresAt},result=>{
  setContext(old=>({...old,grants:[result.grant,...old.grants.filter(item=>item.id!==result.grant.id)]}));
  setCredential({grantId:result.grant.id,value:result.credential});setReview(null);
 });
 const action = (grant,name)=>mutate(`${base}/${encodeURIComponent(grant.id)}/${name}`,{},result=>{
  setContext(old=>({...old,grants:old.grants.map(item=>item.id===result.id?result:item)}));
  if(name==='stop')setCredential(null);
 });
 return <div className="rehearsal-content" aria-busy={busy}>
  <p>The original installation owner can authorize one named copier for a limited time. Copies preserve support history; replies stay unsent.</p>
  {error&&<div role="alert" className="alert alert-danger"><p>{error.message}</p><p>Code: <code>{error.code}</code></p></div>}
  {!context&&!error&&<p role="status">Checking daily copy consent…</p>}
  {credential&&<section className="rehearsal-credential" aria-labelledby="daily-copy-credential-title"><h3 id="daily-copy-credential-title">Credential shown once</h3><p>Give this credential only to the named copier. It cannot be shown again. Clearing it or closing this panel removes it from this page.</p><label className="form-label" htmlFor="daily-copy-credential">Daily copy credential</label><textarea ref={field} id="daily-copy-credential" className="form-control" rows={3} value={credential.value} readOnly autoComplete="off" spellCheck={false} onFocus={event=>event.target.select()}/><div className="move-in-actions"><button type="button" className="btn btn-white" onClick={()=>setCredential(null)}>Clear credential</button></div></section>}
  {context&&<>
   {context.grants.map(item=><GrantStatus key={item.id} grant={item} busy={busy} onAction={action}/>)}
   {!context.grants.some(item=>item.state==='active')&&!credential&&(review?<ConsentReview review={review} busy={busy} onBack={()=>setReview(null)} onGrant={grant}/>:<ConsentForm context={context} busy={busy} onReview={setReview}/>)}
  </>}
  <div className="move-in-actions"><button type="button" className="btn btn-white" disabled={busy} onClick={()=>load(lifetime.current.signal)}>Refresh consent status</button></div>
 </div>;
}
