import React,{useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../transport';
import {Feedback} from './forms';
import {reasonLabel} from './move-in-presentation';

const labels={
 attachment_host_not_owned:'Its link points outside your Zendesk account, so it was not fetched.',
 attachment_deleted:'Deleted in Zendesk.',
 attachment_malware_detected:'Zendesk flagged it as malware, so it was not fetched.',
 attachment_url_missing:'Zendesk gave no download link for it.',
 attachment_comment_not_held:'Its comment is no longer in this workspace.',
 attachment_too_large:'Larger than Zendesk’s 50 MB limit.',
 attachment_unreachable:'Zendesk could not be reached for it. Fetch again to retry.',
 attachment_transfer_failed:'The download broke off. Fetch again to retry.',
 attachment_transfer_incomplete:'The download was shorter than Zendesk said. Fetch again to retry.',
 attachment_transfer_overrun:'The download was longer than Zendesk said, so it was not kept. Fetch again to retry.',
 attachment_size_unknown:'Zendesk gave no size for it, so it was not fetched.',
 attachment_redirect_invalid:'Zendesk’s download answer was incomplete. Fetch again to retry.',
 attachment_too_many_redirects:'Zendesk redirected the download too many times.',
 zendesk_ticket_not_found:'Zendesk no longer returns this ticket.',
 attachments_database_failed:'Saving a file failed. Resume to continue from where it stopped.',
 zendesk_attachments_failed:'The file fetch stopped unexpectedly. Resume to continue from where it stopped.',
 attachments_step_lost:'The file fetch stopped partway. Resume to continue from where it stopped.',
};
const label=code=>{const text=String(code||'');const failed=text.match(/^attachment_download_failed:(\d+)$/);return failed?`Zendesk answered HTTP ${failed[1]} for it. Fetch again to retry.`:labels[text]||reasonLabel(text.replace(/:\d+$/,''))};
const files=n=>`${n} ${n===1?'file':'files'}`;

/** Files on imported Zendesk comments: fetched over the same connection, shown in place. */
export default function MoveInZendeskFiles({base,connected,ready}){
 const poll=useRef(null);
 const [run,setRun]=useState(undefined),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{nativeRequest(`${base}/attachments`).then(r=>setRun(r.data)).catch(e=>setError(e.message))},[base]);
 // Refresh the running fetch in place; the view is never remounted.
 useEffect(()=>{if(!run||run.state!=='running'||run.error)return;poll.current=setInterval(()=>nativeRequest(`${base}/attachments/${run.id}`).then(r=>setRun(r.data)).catch(e=>setError(e.message)),2000);return()=>clearInterval(poll.current)},[base,run?.id,run?.state,run?.error]);
 const post=async path=>{setBusy(true);setError('');try{const result=await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});setRun(result.data)}catch(e){setError(e.message)}finally{setBusy(false)}};
 // Shown once a pull is applied, and whenever a fetch has run.
 if(run===undefined||!run&&!ready)return null;
 const running=run?.state==='running'&&!run.error,stopped=run?.state==='running'&&!!run.error,totals=run?.totals;
 return <section className="mt-3" aria-label="Zendesk files">
  <h3>Files</h3>
  <Feedback error={error}/>
  {!run&&<p className="settings-note">Bring every imported comment’s files and inline images into this workspace. They show on their messages, and files on private notes stay with your team.</p>}
  {stopped&&<p role="alert">{label(run.error)} <button type="button" className="btn btn-white btn-sm" disabled={busy} onClick={()=>post(`${base}/attachments/${run.id}/resume`)}>Resume</button></p>}
  {running&&<p role="status">Fetching files…{run.nextAt>Date.now()?' Zendesk asked us to wait a moment.':''}</p>}
  {totals&&<p>{files(totals.stored)} in{totals.pending?`, ${totals.pending} waiting`:''}{totals.refused?`, ${totals.refused} not fetched`:''}{run.state==='done'?'.':''}</p>}
  {(!run||!running)&&connected&&<button type="button" className="btn btn-white" disabled={busy||!ready} onClick={()=>post(`${base}/attachments`)}>{run?'Fetch what is left':'Fetch files'}</button>}
  {run?.refusalsTotal>0&&<details className="move-in-details"><summary>{run.refusalsTotal} not fetched</summary><ul>{run.refusals.map(r=><li key={`${r.ticketId}/${r.attachmentId}`}>{r.attachmentId?`File ${r.attachmentId} on ticket ${r.ticketId}`:`Ticket ${r.ticketId}`}: {label(r.reason)}</li>)}</ul></details>}
 </section>;
}
