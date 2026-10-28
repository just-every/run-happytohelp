import React,{useState} from 'react';
import {nativeRequest} from '../transport';
import {Section} from '../pages/forms';

/** The owner's own "Send me a test" on the Email settings page: the only place a test message can be requested.
 *  One click sends at most one message to the signed-in owner; the server keeps it durable and never replays it. */
export default function OwnerTestMail({projectId,onComplete,showResult=true}) {
 const [busy,setBusy]=useState(false),[result,setResult]=useState(''),[failed,setFailed]=useState(false);
 const send=async()=>{
  setBusy(true);setResult('');setFailed(false);
  try {
   const {data}=await nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/activation/test-mail`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
   setResult(data.steps.find(step=>step.id==='owner_mail')?.detail||'The request was recorded.');
   await onComplete?.();
  } catch(error) {setFailed(true);setResult(error.message);}
  finally {setBusy(false);}
 };
 return <Section title="Test email to you" description="Send one message to your own address to confirm email leaves this workspace. Opening this page never sends anything.">
  <div className="settings-actions"><button type="button" className="btn btn-white" disabled={busy} onClick={send}>{busy?'Sending…':'Send me a test'}</button></div>
  {result&&(showResult||failed)&&<p role={failed?'alert':'status'} className="settings-note">{result}</p>}
 </Section>;
}
