import React,{useCallback,useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Section,Feedback} from '../forms';
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const stateLabel={accepted:'Sent',uncertain:'Not confirmed',failed:'Not sent',pending:'Retrying',sending:'Sending'};
/** A teammate's own Slack link, per-kind choice and outcomes. Changes save as you go. */
export default function PersonalSlackSettings({projectId}){
 const path=`/api/management/projects/${projectId}/teammate-slack`,[status,setStatus]=useState(null),[outcomes,setOutcomes]=useState([]),[error,setError]=useState(''),[saved,setSaved]=useState(false),[slackId,setSlackId]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(()=>Promise.all([nativeRequest(path),nativeRequest(path+'/outcomes')]).then(([s,o])=>{setStatus(s);setOutcomes(o.data);}).catch(e=>setError(e.message)),[path]);
 useEffect(()=>{load();},[load]);
 const run=async(action,quiet)=>{setBusy(true);setError('');setSaved(false);try{await action();await load();if(!quiet)setSaved(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const toggle=(kind,enabled)=>run(()=>nativeRequest(path+'/preferences',json('PUT',{preferences:[{kind,enabled}]})));
 if(!status)return <Feedback error={error}/>;
 const link=status.link;
 return <Section title="Slack notifications" description="Get these ticket notices as a Slack direct message. Each notice names the ticket and its link only."><Feedback {...{error,saved}}/>
 {!status.available?<p role="status" data-testid="slack-unavailable">Slack notices are unavailable: {status.unavailable_reason}</p>:<>
 {(!link||link.state==='pending')&&<div className="mb-3">
  {!link&&<><label className="form-label" htmlFor="slack-member-id">Your Slack member ID</label><input id="slack-member-id" className="form-control mb-2" value={slackId} maxLength={42} placeholder="U0123ABCD" onChange={e=>setSlackId(e.target.value.trim())}/><button type="button" className="btn btn-outline-secondary" disabled={busy||!slackId} onClick={()=>run(async()=>{await nativeRequest(path+'/link',json('POST',{slack_user_id:slackId}));setSlackId('');},true)}>Send me a code</button></>}
  {link?.state==='pending'&&<><p>We sent a code to {link.slack_user_id} in Slack. Enter it to finish linking.</p><label className="form-label" htmlFor="slack-link-code">Code from Slack</label><input id="slack-link-code" className="form-control mb-2" inputMode="numeric" maxLength={8} value={code} onChange={e=>setCode(e.target.value.trim())}/><button type="button" className="btn btn-primary me-2" disabled={busy||code.length!==8} onClick={()=>run(async()=>{await nativeRequest(path+'/link/verify',json('POST',{code}));setCode('');})}>Verify</button><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={()=>run(()=>nativeRequest(path+'/link',{method:'DELETE'}),true)}>Cancel</button></>}
 </div>}
 {link?.state==='verified'&&<p data-testid="slack-linked">Linked to Slack member {link.slack_user_id}. <button type="button" className="btn btn-link" disabled={busy} onClick={()=>run(()=>nativeRequest(path+'/link',{method:'DELETE'}))}>Unlink</button></p>}
 {status.preferences.map(row=><label key={row.kind} className="form-check"><input className="form-check-input" type="checkbox" disabled={busy} checked={row.enabled} onChange={e=>toggle(row.kind,e.target.checked)}/><span className="form-check-label">{row.label}</span></label>)}
 </>}
 {outcomes.length>0&&<><h3 className="h6 mt-3">Your Slack notices</h3><ul data-testid="slack-outcomes">{outcomes.map(row=><li key={row.id}>Ticket #{row.conversation_id} · {row.label} · {stateLabel[row.state]??row.state}{row.detail&&`: ${row.detail}`}</li>)}</ul></>}
 </Section>;
}
