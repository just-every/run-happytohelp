import React from 'react';
import {literal,when} from './presentation';

export default function GrantStatus({grant,busy,onAction}) {
 const active = grant.state==='active',copies = grant.copies || [],cleanup = grant.cleanup;
 const heading = !active?'Closed':grant.expiresAt<=Date.now()?'End time reached; checking closure':grant.activeDay?`Copy in progress · ${grant.activeDay}`:copies.some(copy=>copy.verifiedAt)?'Active · last copy verified':'Active · awaiting daily copy';
 return <section className="rehearsal-grant" aria-label={`Consent for ${grant.copierId}`}>
  <h3>{grant.copierId}</h3><p role="status">{heading}{!active&&grant.closureReason?` · ${grant.closureReason.replaceAll('_',' ')}`:''}</p>
  <p>Ends {when(grant.expiresAt)} · Generation {grant.generation}</p>
  {active&&<button type="button" className="btn btn-outline-danger" disabled={busy} onClick={()=>onAction(grant,'stop')}>Stop daily copying</button>}
  {!active&&<p>Closed credentials stay invalid. New daily copying requires a new explicit consent.</p>}
  {copies.length>0&&<ul className="rehearsal-copies">{copies.map(copy=><li key={copy.day}><strong>{copy.day}</strong> · {copy.verifiedAt?`Verified ${when(copy.verifiedAt)}`:'Verification pending'}<p>Legacy: {copy.legacyVerified?'verified':'pending'} · Zendesk: {copy.zendeskVerified?'verified':'pending'}</p>{copy.conflicts!==undefined&&<p>Conflicts: <code>{literal(copy.conflicts)}</code></p>}{copy.counts!==undefined&&<details className="move-in-details"><summary>Copy counts</summary><pre>{literal(copy.counts)}</pre></details>}</li>)}</ul>}
  {!active&&cleanup&&<div><p role="status">Source cleanup: {cleanup.state==='complete'?'complete':cleanup.state==='pending'?'pending':cleanup.state}. {cleanup.pendingSources} source packages and {cleanup.stagedRows} staged Zendesk rows remaining.</p>{cleanup.state!=='complete'&&<button type="button" className="btn btn-white" disabled={busy} onClick={()=>onAction(grant,'cleanup')}>Continue source cleanup</button>}<p>Draft cleanup is not implemented by this consent.</p></div>}
  <details className="move-in-details"><summary>Consent scope and cursors</summary><dl className="rehearsal-facts"><dt>Consent ID</dt><dd>{grant.id}</dd><dt>Origin manifest</dt><dd><code>{grant.originManifestSha256}</code></dd><dt>Legacy destination</dt><dd>{grant.legacyProjectId}</dd><dt>Legacy watermark</dt><dd>{when(grant.legacyWatermark)}</dd><dt>Legacy source cutoff</dt><dd>{when(grant.legacyCutoff)}</dd><dt>Zendesk source</dt><dd>{grant.zendeskSubdomain}.zendesk.com</dd><dt>Zendesk destination</dt><dd>{grant.zendeskProjectId}</dd>{grant.closureReason&&<><dt>Closure code</dt><dd><code>{grant.closureReason}</code></dd></>}</dl></details>
 </section>;
}
