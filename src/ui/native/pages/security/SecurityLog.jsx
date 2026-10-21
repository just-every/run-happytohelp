import React,{useCallback,useEffect,useState} from 'react';
import {nativeRequest,downloadFile} from '../../transport';
import {Feedback,Section} from '../forms';
import {useConfirmation} from '../ConfirmDialog';
import '../stack-table.css';
import './security.css';

const CATEGORIES=[['','Everything'],['auth','Sign-in and two-factor'],['access','Roles and teammates'],['data','Imports and exports'],['erasure','Erasure'],['assignment','Assignments'],['approval','Approvals'],['integration','Integrations'],['audit','This log']];
const RETENTION=[['','Keep forever'],['90','90 days'],['180','180 days'],['365','1 year'],['730','2 years'],['2555','7 years']];
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const when=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const LABELS={
 'sign_in.succeeded':'Signed in','sign_in.password_accepted':'Password accepted, second step next','sign_in.email_link_accepted':'Email link accepted, second step next','sign_in.refused':'Sign-in refused',
 'two_factor.verified':'Second step passed','two_factor.refused':'Second step refused','two_factor.enrolled':'Two-factor method added','two_factor.removed':'Two-factor method removed','two_factor.recovery_codes_issued':'New recovery codes','two_factor.reset':'Teammate’s two-factor reset','two_factor.policy_changed':'Two-factor requirement changed',
 'step_up.required':'Asked to confirm it was them','step_up.confirmed':'Confirmed it was them','step_up.refused':'Confirmation refused',
 'password.changed':'Password changed','password.change_refused':'Password change refused','password.reset':'Password reset','account.email_changed':'Sign-in email changed','owner.created':'Workspace owner created','owner.recovered':'Owner recovered access with the installation key','owner.recovery_refused':'Owner recovery refused',
 'member.invited':'Teammate invited','member.invitation_reissued':'Invitation link issued again','member.password_reset_issued':'Teammate password reset link issued','member.joined':'Teammate joined','member.removed':'Teammate removed','member.role_changed':'Role changed','role.created':'Custom role created','role.updated':'Custom role changed','role.deleted':'Custom role deleted','permission.denied':'Refused by role',
 'contact.erased':'Customer erased','audit.exported':'Security log exported','reports.exported':'Report exported','conversation.transcript_sent':'Transcript emailed','project.deleted':'Workspace deleted',
 'availability.presence_changed':'Away when nobody is online changed',
 'import.started':'Import started','import.apply':'Import applied','import.resume':'Import resumed','import.undo':'Import undone',
 'conversation.assigned':'Conversation assigned','conversation.unassigned':'Conversation unassigned','conversation.resolved':'Conversation resolved','conversation.reopened':'Conversation reopened',
 'delegation.approved':'Connected application approved','delegation.reply_sent':'Reply from delegated work approved and sent','local_computer.pairing':'Computer pairing started','local_computer.authorized':'Computer authorized',
 'audit.purged':'Old entries removed by retention','audit.retention_changed':'Retention changed','audit.hold_placed':'Legal hold placed','audit.hold_released':'Legal hold released',
};
const REASONS={code_invalid:'wrong or reused code',recovery_code_invalid:'unknown or used recovery code',passkey_invalid:'passkey not accepted',rate_limited:'too many attempts',password_incorrect:'wrong password',key_incorrect:'wrong recovery key',key_already_used:'recovery key already used',not_owner:'not an owner'};
const describe=row=>LABELS[row.action]||row.action.replace(/[._]/g,' ').replace(/^./,letter=>letter.toUpperCase());
const explain=row=>{const detail=row.detail||{};return [detail.reason&&(REASONS[detail.reason]||detail.reason),detail.permission&&`needs ${detail.permission}`,detail.from&&detail.to&&`${detail.fromName||detail.from} → ${detail.toName||detail.to}`,detail.method&&`with ${detail.method}`,detail.removed!==undefined&&`${detail.removed} removed, ${detail.keptUnderHold} kept under hold`].filter(Boolean).join(' · ')};

/** Settings → Security log: the workspace's append-only record, its export, retention and legal holds. */
export default function SecurityLog({projectId,role}){
 const {ask,dialog}=useConfirmation(),base=`/api/management/projects/${projectId}/audit`,owner=role==='owner';
 const [filter,setFilter]=useState({category:'',since:'',until:''}),[rows,setRows]=useState(null),[next,setNext]=useState(null),[holds,setHolds]=useState([]),[retention,setRetention]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[hold,setHold]=useState({name:'',reason:'',starts_at:'',ends_at:''});
 const query=useCallback((cursor)=>new URLSearchParams(Object.entries({...filter,...(cursor?{cursor}:{})}).filter(([,value])=>value)).toString(),[filter]);
 const load=useCallback(async cursor=>{try{const result=await nativeRequest(`${base}?${query(cursor)}`);setRows(current=>cursor?[...(current||[]),...result.data]:result.data);setNext(result.next);setHolds(result.holds);if(!cursor)setRetention(result.retentionDays===null?'':String(result.retentionDays));}catch(e){setError(e.message)}},[base,query]);
 useEffect(()=>{if(['owner','admin'].includes(role)){setRows(null);load();}},[load,role]);
 if(!['owner','admin'].includes(role))return <p role="alert">Only workspace owners and admins can read the security log.</p>;
 const run=async(action,message)=>{setBusy(true);setError('');setNotice('');try{await action();if(message)setNotice(message);await load();}catch(e){setError(e.message)}setBusy(false)};
 const exportAs=format=>run(()=>downloadFile(`${base}/export?${query()}${query()?'&':''}format=${format}`),null);
 const saveRetention=event=>{event.preventDefault();run(()=>nativeRequest(`${base}/retention`,json('PUT',{days:retention?Number(retention):null})),'Retention saved.')};
 const placeHold=event=>{event.preventDefault();run(async()=>{await nativeRequest(`${base}/holds`,json('POST',hold));setHold({name:'',reason:'',starts_at:'',ends_at:''});},'Legal hold placed.')};
 const release=item=>ask({title:`Release the hold “${item.name}”?`,confirmLabel:'Release',busyLabel:'Releasing…',body:<p>Events it protected follow the normal retention again. The release is recorded in this log.</p>,run:()=>run(()=>nativeRequest(`${base}/holds/${item.id}/release`,{method:'POST'}),'Hold released.')});
 const active=holds.filter(item=>!item.released_at);
 return <div className="workspace-settings security-log" aria-busy={busy}>
  <Feedback error={error}/>{notice&&<div role="status" className="alert alert-success">{notice}</div>}
  <Section title="Activity" description="Every sign-in, two-factor change, role change, import, export, erasure, assignment and approval in this workspace. Entries cannot be edited. Names are shown as they are now; a removed teammate shows as a former teammate.">
   <form className="security-filters" onSubmit={event=>{event.preventDefault();load();}}>
    <div className="form-group"><label className="form-label" htmlFor="log-category">Show</label><select id="log-category" className="form-select" value={filter.category} onChange={event=>setFilter({...filter,category:event.target.value})}>{CATEGORIES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    <div className="form-group"><label className="form-label" htmlFor="log-since">From</label><input id="log-since" type="date" className="form-control" value={filter.since} onChange={event=>setFilter({...filter,since:event.target.value})}/></div>
    <div className="form-group"><label className="form-label" htmlFor="log-until">Before</label><input id="log-until" type="date" className="form-control" value={filter.until} onChange={event=>setFilter({...filter,until:event.target.value})}/></div>
    <div className="security-filters__actions"><button type="button" className="btn btn-white" onClick={()=>exportAs('csv')} disabled={busy}>Export CSV</button><button type="button" className="btn btn-white" onClick={()=>exportAs('json')} disabled={busy}>Export JSON</button></div>
   </form>
   {rows===null?<p>Loading…</p>:rows.length===0?<p className="settings-note">Nothing recorded for this filter yet.</p>:<div className="table-responsive"><table className="table stack-table security-events"><thead><tr><th>When</th><th>What</th><th>Who</th><th>Result</th></tr></thead><tbody>
    {rows.map(row=><tr key={row.id}><td data-label="When"><time dateTime={new Date(row.at).toISOString()}>{when(row.at)}</time></td>
     <td data-label="What"><span><strong>{describe(row)}</strong>{explain(row)&&<><br/><small>{explain(row)}</small></>}{row.target_type&&<><br/><small className="text-muted">{row.target_type} {row.target_id}</small></>}{row.purpose&&<><br/><small className="text-muted">{row.purpose}</small></>}</span></td>
     <td data-label="Who"><span>{row.actor}<br/><small className="text-muted">{row.source}</small></span></td>
     <td data-label="Result"><span className={`security-badge security-badge--${row.outcome}`}>{row.outcome}</span>{row.held&&<span className="security-badge security-badge--held" title="Protected by a legal hold">held</span>}</td></tr>)}
   </tbody></table></div>}
   {next&&<button type="button" className="btn btn-white" disabled={busy} onClick={()=>load(next)}>Show older entries</button>}
  </Section>
  <form onSubmit={saveRetention}><Section title="Retention" description="How long this log keeps entries. Older entries are removed once a day, except those a legal hold protects. Each removal is itself recorded.">
   <div className="form-group"><label className="form-label" htmlFor="log-retention">Keep entries for</label><select id="log-retention" className="form-select" value={retention} disabled={!owner} onChange={event=>setRetention(event.target.value)}>{RETENTION.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   {owner?<div className="settings-actions"><button className="btn btn-primary" disabled={busy}>Save retention</button></div>:<p className="settings-note">Only an owner can change retention.</p>}
  </Section></form>
  <Section title="Legal holds" description="A hold keeps every entry in its period, whatever the retention, until an owner releases it.">
   {holds.length>0&&<ul className="security-holds">{holds.map(item=><li key={item.id}><strong>{item.name}</strong> <span className="text-muted">{item.starts_at?`from ${new Date(item.starts_at).toLocaleDateString()}`:'all earlier entries'}{item.ends_at?` to ${new Date(item.ends_at).toLocaleDateString()}`:' onwards'}</span><br/><small>{item.reason}</small>{item.released_at?<small className="text-muted"> · released {when(item.released_at)}</small>:owner&&<button type="button" className="btn btn-link btn-sm" onClick={()=>release(item)}>Release</button>}</li>)}</ul>}
   {active.length===0&&<p className="settings-note">No hold is active.</p>}
   {owner&&<form className="security-hold-form" onSubmit={placeHold}>
    <div className="form-group"><label className="form-label" htmlFor="hold-name">Name</label><input id="hold-name" className="form-control" required maxLength={120} value={hold.name} onChange={event=>setHold({...hold,name:event.target.value})}/></div>
    <div className="form-group"><label className="form-label" htmlFor="hold-reason">Reason</label><input id="hold-reason" className="form-control" required maxLength={2000} value={hold.reason} onChange={event=>setHold({...hold,reason:event.target.value})}/></div>
    <div className="form-group"><label className="form-label" htmlFor="hold-start">From (optional)</label><input id="hold-start" type="date" className="form-control" value={hold.starts_at} onChange={event=>setHold({...hold,starts_at:event.target.value})}/></div>
    <div className="form-group"><label className="form-label" htmlFor="hold-end">To (optional)</label><input id="hold-end" type="date" className="form-control" value={hold.ends_at} onChange={event=>setHold({...hold,ends_at:event.target.value})}/></div>
    <div className="settings-actions"><button className="btn btn-primary" disabled={busy}>Place hold</button></div>
   </form>}
  </Section>
  {dialog}</div>;
}
