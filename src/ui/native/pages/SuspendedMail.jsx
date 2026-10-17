import {Link} from '@tanstack/react-router';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {nativeRequest} from '../transport';
import {useConfirmation} from './ConfirmDialog';
import SuspendedDetail from './email/SuspendedDetail';
import SenderRules from './email/SenderRules';
import {jsonBody,readableDate} from './email/mail-api';
import './email/email.css';

export default function SuspendedMail({projectId,role}) {
 const canManageRules=['owner','admin'].includes(role),[ruleRevision,setRuleRevision]=useState(0);
 const path=`/api/management/projects/${encodeURIComponent(projectId)}/suspended`;
 const [result,setResult]=useState(null),[selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[recoveredId,setRecoveredId]=useState(null);
 const {ask,dialog}=useConfirmation(), selection=useRef(0);
 const oldestTime=result?.oldest_at?new Date(typeof result.oldest_at==='number'&&result.oldest_at<1e12?result.oldest_at*1000:result.oldest_at).getTime():null;
 const oldestAge=oldestTime&&!Number.isNaN(oldestTime)?Math.max(0,Math.floor((Date.now()-oldestTime)/3600000)):null;
 const load=useCallback(async()=>{const response=await nativeRequest(path);setResult(response);},[path]);
 useEffect(()=>{const controller=new AbortController();setResult(null);setSelected(null);setDetail(null);setRecoveredId(null);setError('');nativeRequest(path,{signal:controller.signal}).then(setResult).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});return()=>controller.abort();},[path]);
 const open=async id=>{const request=++selection.current;setSelected(id);setDetail(null);setError('');try{const response=await nativeRequest(`${path}/${encodeURIComponent(id)}`);if(request===selection.current)setDetail(response.data);}catch(failure){if(request===selection.current)setError(failure.message);}};
 const act=async(suffix,init,message,remove=false)=>{
  if(busy)return;setBusy(true);setError('');setNotice('');setRecoveredId(null);
  try{const response=await nativeRequest(path+suffix,init);if(response.conversationId)setRecoveredId(response.conversationId);if(remove){selection.current++;setSelected(null);setDetail(null);}setNotice(message);await load();}
  catch(failure){setError(failure.message);}finally{setBusy(false);}
 };
 const remove=mail=>ask({title:'Delete suspended email?',body:<p>Delete “{mail.subject||'(No subject)'}” from {mail.from_address}? This cannot be recovered afterward.</p>,run:async()=>{await nativeRequest(`${path}/${encodeURIComponent(mail.id)}`,{method:'DELETE'});selection.current++;setSelected(null);setDetail(null);setNotice('Suspended email deleted.');await load();}});
 const recover=(mail,body)=>act(`/${encodeURIComponent(mail.id)}/recover`,jsonBody('POST',body),body.asNote?body.conversationId?'Email recovered as a private operator note.':'A new ticket was created with the recovered email as a private note.':'Email recovered to the selected conversation.',true);
 const rule=(address,action)=>ask({title:`${action==='allow'?'Allow':action==='block'?'Block':'Remove rule for'} ${address}?`,body:<p>{action==='block'?'Future email matching this address or domain will be blocked.':action==='allow'?'Future email matching this address or domain will be allowed by the sender rule. Authentication and identity checks still apply.':'Future mail from this sender will use the normal sender policy.'}</p>,confirmLabel:action==='remove'?'Remove rule':action==='allow'?'Allow sender':'Block sender',busyLabel:'Saving…',run:async()=>{await nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/sender-rules`,jsonBody('POST',{address,action}));setRecoveredId(null);setNotice('Sender rule saved.');setRuleRevision(value=>value+1);}});
 return <div className="workspace-settings email-workspace" aria-busy={busy}>
  {error&&<p className="alert alert-danger" role="alert">{error}</p>}{notice&&<p className="alert alert-info" role="status">{notice}{recoveredId&&<> <Link to={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(recoveredId)}`}>Open recovered ticket</Link></>}</p>}
  <p className="settings-note">Mail held for review stays separate from customer conversations until you recover it.</p>
  <div className="email-actions"><span><strong>{result?.count??'—'}</strong> suspended</span><span>Oldest: {readableDate(result?.oldest_at)}{oldestAge!==null&&` (${oldestAge<24?`${oldestAge} hours`:`${Math.floor(oldestAge/24)} days`} old)`}</span><button type="button" className="btn btn-white" disabled={busy} onClick={()=>load().catch(failure=>setError(failure.message))}>Refresh</button></div>
  {!result&&!error&&<p role="status">Loading suspended mail…</p>}
  {result?.data.length===0&&<div className="settings-empty"><p>No suspended mail.</p>Emails needing review appear here.</div>}
  {result&&result.data.length>0&&<div className="email-suspended-layout"><div><ul className="email-suspended-list">{result.data.map(mail=><li key={mail.id}><button type="button" disabled={busy} aria-pressed={selected===mail.id} onClick={()=>open(mail.id)}><strong>{mail.subject||'(No subject)'}</strong><span>{mail.from_address}</span><span>{mail.reason?.replaceAll('_',' ')} · {readableDate(mail.created_at)}</span></button></li>)}</ul>{result.next_cursor&&<button type="button" className="btn btn-white mt-3" disabled={busy} onClick={async()=>{setBusy(true);try{const response=await nativeRequest(`${path}?cursor=${encodeURIComponent(result.next_cursor)}`);setResult(current=>({...response,data:[...current.data,...response.data]}));}catch(failure){setError(failure.message);}finally{setBusy(false);}}}>Load more</button>}</div>{detail?<SuspendedDetail key={detail.id} mail={detail} path={`${path}/${encodeURIComponent(detail.id)}`} busy={busy} onRecover={recover} onDelete={remove} onRule={canManageRules?rule:undefined}/>:<p className="settings-note" role="status">{selected?'Loading email…':'Select an email to inspect its reason, authentication and content.'}</p>}</div>}
  {result&&canManageRules&&<SenderRules projectId={projectId} revision={ruleRevision} busy={busy} onRule={rule}/>}
  {dialog}
 </div>;
}
