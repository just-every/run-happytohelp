import React,{useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../transport';
import {Feedback,Field} from './forms';
import CopyCommand from '../setup-help/CopyCommand';
import {reasonLabel} from './move-in-presentation';

const returned={connected:'Zendesk is connected.',denied:'Zendesk sign-in was cancelled. Choose Connect to try again.',expired:'The Zendesk sign-in took too long. Choose Connect again.',failed:'Zendesk did not accept the sign-in. Check the client Identifier and its redirect URL, then connect again.',conflict:'This workspace already holds history from another Zendesk account.'};
const working=['pulling','reviewing','applying'];
const phases={fields:'Reading ticket fields',articles:'Reading Help Center articles',organizations:'Reading organizations',users:'Reading people',tickets:'Reading tickets',comments:'Reading every comment',people:'Reading people the tickets mention',packing:'Preparing batches for review',review:'Preparing the review',apply:'Importing approved batches',done:'Done'};
const count=(n,one,many=`${one}s`)=>`${n} ${n===1?one:many}`;

/** Connect a Public OAuth client, pull the whole account and approve it once. */
export default function MoveInZendesk({projectId,onOpenRun}){
 const base=`/api/move-in/projects/${projectId}/zendesk`,poll=useRef(null);
 const [connection,setConnection]=useState(null),[pull,setPull]=useState(null),[form,setForm]=useState({subdomain:'',clientId:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [notice]=useState(()=>returned[new URLSearchParams(window.location.search).get('zendesk')]||'');
 const load=()=>Promise.all([nativeRequest(`${base}/connection`),nativeRequest(`${base}/pulls`)]).then(([c,p])=>{setConnection(c);setPull(p.data[0]||null)}).catch(e=>setError(e.message));
 useEffect(()=>{load()},[base]);
 // Refresh the active pull in place; the view is never remounted.
 useEffect(()=>{if(!pull||!working.includes(pull.state)||pull.error)return;poll.current=setInterval(()=>nativeRequest(`${base}/pulls/${pull.id}`).then(r=>setPull(r.data)).catch(e=>setError(e.message)),2000);return()=>clearInterval(poll.current)},[base,pull?.id,pull?.state,pull?.error]);
 const act=async(path,options)=>{setBusy(true);setError('');try{return await nativeRequest(path,options)}catch(e){setError(e.message)}finally{setBusy(false)}};
 const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const connect=async event=>{event.preventDefault();const result=await act(`${base}/connect`,json(form));if(result?.url)window.location.assign(result.url)};
 const start=async()=>{const result=await act(`${base}/pulls`,json({}));if(result)setPull(result.data)};
 const step=async name=>{const result=await act(`${base}/pulls/${pull.id}/${name}`,json(name==='approve'?{fingerprint:pull.fingerprint}:{}));if(result)setPull(result.data)};
 const disconnect=async()=>{const result=await act(`${base}/connection`,{method:'DELETE'});if(result){setError(result.revoke.outcome==='revoked'?'':`Disconnected here. Zendesk ${result.revoke.outcome==='refused'?`did not revoke the token (HTTP ${result.revoke.status}); revoke it under Admin Center, Apps and integrations, APIs, OAuth clients`:'could not be reached to revoke the token'}.`);await load()}};
 if(!connection)return <div className="sh-steps mt-3"><Feedback error={error}/><p role="status">Checking the Zendesk connection…</p></div>;
 const redirect=`${window.location.origin}/api/move-in/zendesk/callback`;
 return <div className="sh-steps mt-3" data-zendesk-connection={connection.state}><Feedback error={error}/>{notice&&<p role="status">{notice}</p>}
  {!connection.connected?<>
   <p><b>Connect Zendesk</b> to bring in every ticket, archived ones included, with all comments, people, organizations and Help Center articles. Only reading is allowed, and the sign-in stays in this workspace.</p>
   {connection.state==='reconnect'&&<p role="alert">Reconnect Zendesk: its sign-in expired or was refused.</p>}
   <ol>
    <li>In Zendesk Admin Center, open <b>Apps and integrations</b>, <b>APIs</b>, <b>OAuth clients</b>, and add a client. Choose Client kind <b>Public</b>, allowed scopes <b>read</b> and <b>hc:read</b>, and this redirect URL:<CopyCommand text={redirect}/></li>
    <li>Save, then enter its <b>Identifier</b> here.</li>
   </ol>
   <form onSubmit={connect}>
    <Field name="subdomain" label="Zendesk subdomain" hint="acme for acme.zendesk.com" value={form.subdomain} onChange={(_,value)=>setForm(old=>({...old,subdomain:value}))} required/>
    <Field name="clientId" label="OAuth client Identifier" value={form.clientId} onChange={(_,value)=>setForm(old=>({...old,clientId:value}))} required/>
    <button className="btn btn-primary" disabled={busy||!form.subdomain||!form.clientId}>Connect</button>
   </form>
  </>:<>
   <p><b>Connected to {connection.subdomain}.zendesk.com</b> <button type="button" className="btn btn-link" disabled={busy||working.includes(pull?.state)} onClick={disconnect}>Disconnect</button></p>
   {!pull||['applied','abandoned'].includes(pull.state)?<button type="button" className="btn btn-primary" disabled={busy} onClick={start}>{pull?.state==='applied'?'Pull new and changed history':'Pull everything'}</button>:null}
  </>}
  {pull&&<PullStatus pull={pull} busy={busy} onStep={step} onOpenRun={onOpenRun}/>}
 </div>;
}

function PullStatus({pull,busy,onStep,onOpenRun}){
 const {tickets,articles,replies,keptAsImported:kept}=pull.totals,covered=pull.batches.filter(b=>b.covered),refusedInCovered=covered.some(b=>b.summary?.refused>0);
 const heading=pull.state==='ready'?'Ready for your approval':pull.state==='applied'?'Pull imported':pull.state==='abandoned'?'Pull stopped':phases[pull.phase]||'Working';
 return <section className="mt-3" aria-label="Zendesk pull">
  <h3>{heading}</h3>
  {pull.error?<p role="alert">{reasonLabel(pull.error.replace(/:\d+$/,''))} <button type="button" className="btn btn-white btn-sm" disabled={busy} onClick={()=>onStep('resume')}>Resume pull</button></p>:working.includes(pull.state)&&<p role="status">{phases[pull.phase]||'Working'}…{pull.nextAt>Date.now()?' Zendesk asked us to wait a moment.':''}</p>}
  <ul>
   <li>Tickets: {tickets.seen} seen, {tickets.deleted} deleted in Zendesk (not imported){tickets.alreadyImported?`, ${tickets.alreadyImported} already imported`:''}, {tickets.imported} imported, {tickets.refused} refused</li>
   {replies.seen>0&&<li>New replies on imported tickets: {replies.imported} imported, {replies.refused} refused</li>}
   {kept.tickets+kept.users+kept.organizations>0&&<li>Changed in Zendesk, kept as imported: {count(kept.tickets,'ticket')}, {count(kept.users,'person','people')}, {count(kept.organizations,'organization')}</li>}
   <li>People: {pull.totals.users} · Organizations: {pull.totals.organizations}</li>
   <li>Articles: {articles.published} to publish, {articles.draft} drafts, {articles.heldBack} held back for restricted audiences{articles.unavailable?' (no Help Center)':''}</li>
   <li>Batches: {pull.progress.batchesReviewed} of {pull.progress.batches} reviewed, {pull.progress.batchesApplied} imported</li>
  </ul>
  {pull.state==='ready'&&<div className="move-in-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>onStep('approve')}>{covered.length?`Approve and import ${count(covered.length,'batch','batches')}`:'Approve: nothing new to import'}</button>{refusedInCovered&&<span className="settings-note">Refused records stay out; everything else imports.</span>}</div>}
  {pull.batches.length>0&&<details className="move-in-details"><summary>Batches</summary><ul>{pull.batches.map(b=><li key={b.ordinal}><button type="button" className="btn btn-link" onClick={()=>onOpenRun(b.runId)}>{b.filename}</button> {b.stopped?`stopped: ${reasonLabel(b.error)}`:b.nothingToImport?'nothing to import':b.state}</li>)}</ul></details>}
  {pull.refusalsTotal>0&&<details className="move-in-details"><summary>{count(pull.refusalsTotal,'refused record')}</summary><ul>{pull.refusals.map(r=><li key={`${r.kind}/${r.sourceId}`}>{r.kind.replace('_',' ')} {r.sourceId}: {reasonLabel(r.reason)}</li>)}</ul></details>}
  {['pulling','reviewing','ready'].includes(pull.state)&&<button type="button" className="btn btn-link" disabled={busy} onClick={()=>onStep('abandon')}>Stop this pull</button>}
 </section>;
}
