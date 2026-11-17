import React, {useState} from 'react';
import {Link} from '@tanstack/react-router';
import {jsonBody,mailboxPath,readMail} from './mail-api';

export default function MailboxHistory({mailbox,projectId,act,busy,onReconnect,onDisconnect,onLive}) {
 const [folders,setFolders]=useState(null),[selected,setSelected]=useState([]),[error,setError]=useState(''),[result,setResult]=useState(null),[loading,setLoading]=useState(false);
 const prefix=`/${encodeURIComponent(mailbox.id)}`;
 const load=async()=>{setLoading(true);setError('');try{const response=await readMail(`${mailboxPath(projectId)}${prefix}/history/folders`);setFolders(response.data);}catch(failure){setError(failure.message);}finally{setLoading(false);}};
 const review=async()=>{const response=await act(`${prefix}/history`,jsonBody('POST',{folders:selected}),'');if(response)setResult(response);};
 const importId=result?.data?.id||mailbox.cursor?.importId;
 return <div className="email-mailbox-detail">
  <h3>Import history only</h3>
  <p>Read the folders you choose, then review and approve the history in Move in. No mail is sent, changed or received live. Historical conversations stay private to your team and out of Reports.</p>
  {error&&<p role="alert" className="alert alert-danger">{error}</p>}
  <button type="button" className="btn btn-white" onClick={load} disabled={busy||loading||mailbox.status!=='connected'}>{loading?'Reading folders…':'Choose folders'}</button>
  {folders&&<fieldset className="email-editor" disabled={busy||loading}><legend>Folders to import</legend><p>Only messages in the selected folders are included. A thread is grouped from those messages; messages in other folders are left out.</p><div className="email-history-folders">{folders.map(folder=><label key={folder.id}><input type="checkbox" checked={selected.includes(folder.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,folder.id]:current.filter(id=>id!==folder.id))}/><span>{folder.name}</span></label>)}</div><button type="button" className="btn btn-primary" disabled={!selected.length} onClick={review}>Review history</button></fieldset>}
  {result?.empty&&<p role="status">These folders contain no messages.</p>}
  {importId&&<p role="status">History is available in <Link to={`/projects/${projectId}/move-in`} search={{import:importId}}>Move in</Link>. Review its records and approve before anything appears in your inbox. Undo there follows the same protection for records edited after import.</p>}
  <p className="settings-note">The current import limits apply. A selection that cannot fit is refused with nothing imported; choose smaller folders. Unsupported attachments are named in the review.</p>
  <details className="email-editor"><summary>Turn on live mail</summary><p>When you are ready to answer customers here, authorize sending and receiving separately. New and existing Inbox messages will enter as live mail and may start your enabled replies, AI and workflows. Imported conversations remain historical.</p><p>A technical person needs to register the provider app and install its credentials first. IMAP also needs an allowed SMTP server and sending credentials. Your provider or administrator may need to approve the extra permission.</p><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>onLive(mailbox)}>Turn on live mail</button></details>
  <div className="email-actions"><button type="button" className="btn btn-white" disabled={busy} onClick={()=>onReconnect(mailbox)}>Reconnect read access</button><button type="button" className="btn btn-outline-danger" disabled={busy} onClick={()=>onDisconnect(mailbox)}>Disconnect mailbox</button></div>
 </div>;
}
