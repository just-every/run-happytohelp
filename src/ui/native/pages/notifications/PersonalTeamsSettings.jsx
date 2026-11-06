import React,{useCallback,useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Section,Feedback} from '../forms';
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const stateLabel={accepted:'Sent',uncertain:'Not confirmed',failed:'Not sent',pending:'Retrying',sending:'Sending'};
export default function PersonalTeamsSettings({projectId}){
 const path=`/api/management/projects/${projectId}/teammate-teams`,[status,setStatus]=useState(null),[outcomes,setOutcomes]=useState([]),[code,setCode]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const load=useCallback(()=>Promise.all([nativeRequest(path),nativeRequest(path+'/outcomes')]).then(([s,o])=>{setStatus(s);setOutcomes(o.data);if(s.link)setCode(null);}),[path]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 const run=async(action,quiet=false)=>{setBusy(true);setError('');setSaved(false);try{await action();await load();if(!quiet)setSaved(true);}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <Section title="Teams notifications" description="Receive ticket notices in your personal chat with the installed Teams bot. Notices contain only the ticket reference and link."><div data-testid="teams-personal"><Feedback {...{error,saved}}/>
 {status&&!status.available&&<p role="status" data-testid="teams-unavailable">Teams notices are unavailable: {status.unavailable_reason}</p>}
 {status?.available&&!status.link&&<p role="status">Teams delivery is unavailable until you link your personal chat.</p>}
 {status?.available&&<>
 {status.link?<p data-testid="teams-linked">Your personal Teams chat is linked.</p>:code?<div className="mb-3"><p>Send this single-use command in a personal chat with the installed Teams bot within ten minutes:</p><p style={{overflowWrap:'anywhere'}} data-testid="teams-link-command">notify link {code.code}</p><button type="button" className="btn btn-outline-secondary" style={{minHeight:44}} disabled={busy} onClick={()=>run(async()=>{},true)}>Refresh Teams link</button></div>:<button type="button" className="btn btn-outline-secondary mb-3" style={{minHeight:44}} disabled={busy} onClick={()=>run(async()=>setCode(await nativeRequest(path+'/link',{method:'POST'})),true)}>Create Teams link code</button>}
 {status.preferences.map(row=><label key={row.kind} className="form-check d-flex align-items-center gap-2" style={{minHeight:44}}><input className="form-check-input" type="checkbox" disabled={busy} checked={row.enabled} onChange={e=>run(()=>nativeRequest(path+'/preferences',json('PUT',{preferences:[{kind:row.kind,enabled:e.target.checked}]})))}/><span className="form-check-label">{row.label}</span></label>)}
 </>}
 {(status?.link||code)&&<button type="button" className="btn btn-link" style={{minHeight:44}} disabled={busy} onClick={()=>run(async()=>{await nativeRequest(path+'/link',{method:'DELETE'});setCode(null);})}>{status?.link?'Unlink Teams':'Cancel Teams link'}</button>}
 {outcomes.length>0&&<><h3 className="h6 mt-3">Your Teams notices</h3><ul data-testid="teams-outcomes">{outcomes.map(row=><li key={row.id}>Ticket #{row.conversation_id} · {row.label} · {stateLabel[row.state]??row.state}{row.detail&&`: ${row.detail}`}</li>)}</ul></>}
 </div></Section>;
}
