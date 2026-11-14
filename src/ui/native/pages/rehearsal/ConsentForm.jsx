import React,{useState} from 'react';
import {DAY,connectionKey,literal,localInput,when} from './presentation';

export function ConsentReview({review,busy,onBack,onGrant}) {
 const {context,adoption,connection,copierId,expiresAt} = review;
 return <div className="rehearsal-review">
  <h3>Review daily copy consent</h3>
  <p>Allow this named copier to bring new legacy and Zendesk history into these workspaces until the end time. This consent does not allow sending replies, creating connections or changing the destination.</p>
  <dl className="rehearsal-facts">
   <dt>Installation</dt><dd>{context.installationId}</dd>
   <dt>Application</dt><dd>{context.appOrigin}</dd>
   <dt>Original owner</dt><dd>{context.owner.email} · {context.owner.id}</dd>
   <dt>Setup workspace</dt><dd>{context.setupProjectId}</dd>
   <dt>Copier</dt><dd>{copierId}</dd>
   <dt>Accepted legacy source</dt><dd><code>{adoption.manifestSha256}</code></dd>
   <dt>Legacy source and destination</dt><dd>{adoption.destinationProjectId}</dd>
   <dt>Origin verified</dt><dd>{when(adoption.verifiedAt)}</dd>
   <dt>Legacy watermark</dt><dd>{when(adoption.legacyWatermark)}</dd>
   <dt>Source cutoff</dt><dd>{when(adoption.legacyCutoff)}</dd>
   <dt>Zendesk source</dt><dd>{connection.subdomain}.zendesk.com</dd>
   <dt>Zendesk destination</dt><dd>{connection.projectId}</dd>
   <dt>Accepted Zendesk pull</dt><dd>{connection.pullId}</dd>
   <dt>Connection generation</dt><dd>{connection.connectionGeneration}</dd>
   <dt>Accepted Zendesk cursor</dt><dd><pre>{literal(connection.acceptedCursor)}</pre></dd>
   <dt>Consent ends (UTC)</dt><dd>{when(expiresAt)}</dd>
  </dl>
  <p>Stop or Pause closes this consent. Resuming agents does not restore it. A later consent creates a new credential.</p>
  <div className="move-in-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={onGrant}>{busy?'Granting…':'Grant daily copy consent'}</button><button type="button" className="btn btn-white" disabled={busy} onClick={onBack}>Back to details</button></div>
 </div>;
}

export default function ConsentForm({context,busy,onReview}) {
 const [sha,setSha] = useState(''),[connectionId,setConnectionId] = useState(''),[copierId,setCopierId] = useState(''),[end,setEnd] = useState(()=>localInput(Date.now()+7*DAY)),[error,setError] = useState('');
 const adoption = context.adoptions.find(item=>item.manifestSha256===sha);
 const connection = context.connections.find(item=>connectionKey(item)===connectionId);
 const ready = adoption?.sourceClockReady && adoption.legacyWatermark && adoption.legacyCutoff && connection?.pullId && connection.acceptedCursor !== undefined && connection.acceptedCursor !== null;
 const submit = event => {
  event.preventDefault();
  const expiresAt = new Date(end).getTime();
  if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+14*DAY){setError('Choose an end time in the next 14 days.');return;}
  if(!ready || !copierId.trim()) return;
  setError('');onReview({context,adoption,connection,copierId:copierId.trim(),expiresAt});
 };
 return <form onSubmit={submit} className="rehearsal-form">
  <h3>New daily copy consent</h3>
  {!context.adoptions.length&&<p>First complete and verify a full HappyToHelp workspace adoption here.</p>}
  {!context.connections.length&&<p>First import history using an existing Zendesk connection in the destination workspace.</p>}
  <div className="form-group"><label className="form-label" htmlFor="daily-copy-origin">Accepted legacy adoption</label><select id="daily-copy-origin" className="form-select" required value={sha} onChange={e=>setSha(e.target.value)} disabled={busy}><option value="">Choose a verified adoption</option>{context.adoptions.map(item=><option key={item.manifestSha256} value={item.manifestSha256}>{item.destinationProjectId} · {item.manifestSha256}</option>)}</select></div>
  {adoption&&!adoption.sourceClockReady&&<p role="status">This adoption needs a verified source cutoff and watermark before daily copying can be approved.</p>}
  <div className="form-group"><label className="form-label" htmlFor="daily-copy-zendesk">Existing Zendesk import</label><select id="daily-copy-zendesk" className="form-select" required value={connectionId} onChange={e=>setConnectionId(e.target.value)} disabled={busy}><option value="">Choose an imported connection</option>{context.connections.map(item=><option key={connectionKey(item)} value={connectionKey(item)}>{item.subdomain}.zendesk.com → {item.projectId}</option>)}</select></div>
  <div className="form-group"><label className="form-label" htmlFor="daily-copy-copier">Named copier ID</label><input id="daily-copy-copier" className="form-control" pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,159}" required maxLength={160} autoComplete="off" value={copierId} onChange={e=>setCopierId(e.target.value)} disabled={busy}/></div>
  <div className="form-group"><label className="form-label" htmlFor="daily-copy-end">Consent end time (your local time)</label><input id="daily-copy-end" className="form-control" type="datetime-local" required min={localInput(Date.now()+60000)} max={localInput(Date.now()+14*DAY)} value={end} onChange={e=>setEnd(e.target.value)} disabled={busy} aria-describedby="daily-copy-end-note"/><p id="daily-copy-end-note">Up to 14 days. The review shows the exact UTC end time.</p></div>
  {adoption&&connection&&!ready&&adoption.sourceClockReady&&<p role="status">Source clock or accepted cursor details are unavailable. Refresh status before reviewing consent.</p>}
  {error&&<p role="alert">{error}</p>}
  <button className="btn btn-white" disabled={busy||!ready||!copierId.trim()}>Review consent</button>
 </form>;
}
