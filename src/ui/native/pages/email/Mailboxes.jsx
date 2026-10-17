import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Link} from '@tanstack/react-router';
import {Section} from '../forms';
import {useConfirmation} from '../ConfirmDialog';
import MailboxEditor from './MailboxEditor';
import MailboxDetails from './MailboxDetails';
import {jsonBody,mailboxPath,readMail} from './mail-api';
import './email.css';

export default function Mailboxes({projectId,role}) {
 const [result,setResult]=useState(null),[agents,setAgents]=useState([]),[selected,setSelected]=useState(null),[editor,setEditor]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const {ask,dialog}=useConfirmation(), path=mailboxPath(projectId), allowed=['owner','admin'].includes(role), alive=useRef(true);
 const load=useCallback(async()=>{const response=await readMail(path);if(alive.current)setResult(response);},[path]);
 useEffect(()=>{alive.current=true;setResult(null);setError('');setSelected(null);setEditor(null);if(allowed){load().catch(failure=>setError(failure.message));readMail(`/api/management/projects/${encodeURIComponent(projectId)}/agents`).then(response=>{if(alive.current)setAgents(response.data.filter(agent=>agent.id&&!agent.pending));}).catch(failure=>{if(alive.current)setError(failure.message);});}return()=>{alive.current=false;};},[load,allowed,projectId]);
 const act=async(suffix,init,message)=>{
  if(busy)return null;setBusy(true);setError('');setNotice('');
  try{const response=await readMail(path+suffix,init);if(alive.current){setNotice(message);await load();}return response;}
  catch(failure){if(alive.current)setError(failure.message);return null;}finally{if(alive.current)setBusy(false);}
 };
 const reconnect=async mailbox=>{
  if(mailbox.provider==='imap'){setEditor(mailbox);return;}
  const response=await act(`/${encodeURIComponent(mailbox.id)}/reconnect`,jsonBody('POST',{}),mailbox.provider==='forwarding'?'Mailbox reconnected.':'Opening provider authorization…');
  if(response?.url){const target=new URL(response.url,location.origin);if(target.protocol==='https:')location.assign(target.href);else setError('Authorization returned an invalid URL.');}
 };
 const disconnect=mailbox=>ask({title:`Disconnect ${mailbox.address}?`,body:<p>Mail sync stops. Existing conversations and email history remain. Reconnect this mailbox to resume receiving.</p>,confirmLabel:'Disconnect',busyLabel:'Disconnecting…',run:async()=>{await readMail(`${path}/${encodeURIComponent(mailbox.id)}`,{method:'DELETE'});setNotice('Mailbox disconnected.');await load();}});
 if(!allowed)return null;
 return <Section title="Mailboxes" description="Connect shared support addresses, choose sender names and signatures, and manage receiving history.">
  <div className="email-workspace" aria-busy={busy} onKeyDown={event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT')event.preventDefault();}}>
   {error&&<p role="alert" className="alert alert-danger">{error}</p>}{notice&&<p role="status" className="alert alert-info">{notice}</p>}
   <div className="email-actions"><button type="button" className="btn btn-primary" onClick={()=>setEditor('create')} disabled={busy}>Add mailbox</button><button type="button" className="btn btn-white" disabled={busy} onClick={()=>load().catch(failure=>setError(failure.message))}>Refresh</button><Link to={`/projects/${projectId}/suspended`}>Suspended mail</Link></div>
   {!result&&!error&&<p role="status">Loading mailboxes…</p>}
   {result?.data.length===0&&<div className="settings-empty"><p>No connected mailboxes yet.</p>Forward an address on your domain or connect Google, Microsoft or IMAP.</div>}
   {result?.data.map(mailbox=><div className="email-mailbox" key={mailbox.id}>
    <div className="email-mailbox-heading"><button type="button" className="btn btn-link email-mailbox-title" aria-expanded={selected===mailbox.id} onClick={()=>{setSelected(selected===mailbox.id?null:mailbox.id);setEditor(null);}}><strong>{mailbox.display_name||mailbox.address}</strong><span>{mailbox.address}</span></button><span className="h2h-chip h2h-chip--muted">{mailbox.provider==='microsoft'?'Microsoft Graph':mailbox.provider} · {mailbox.status?.replaceAll('_',' ')}</span></div>
    {selected===mailbox.id&&<MailboxDetails key={mailbox.id} mailbox={mailbox} agents={agents} act={act} busy={busy} onReconnect={reconnect} onDisconnect={disconnect}/>}
   </div>)}
   {editor&&<MailboxEditor key={editor.id||'create'} act={act} oauth={result?.oauth} socketHosts={result?.socketHosts} socketPorts={result?.socketPorts} busy={busy} reconnect={editor==='create'?null:editor} onDone={()=>setEditor(null)}/>}
   {dialog}
  </div>
 </Section>;
}
