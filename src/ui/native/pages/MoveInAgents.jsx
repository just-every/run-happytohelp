import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../transport';
import {Feedback} from './forms';

/** Mapping records an existing member choice; access and assignments wait for cutover. */
export default function MoveInAgents({base,run,busy,onBusy,onRun,onDirty}){
 const agents=run.api.agents||[],members=run.api.members||[];
 const signature=JSON.stringify(Object.fromEntries(agents.map(agent=>[String(agent.id),agent.memberId==null?null:String(agent.memberId)])));
 const [mapping,setMapping]=useState(()=>JSON.parse(signature)),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const dirty=JSON.stringify(mapping)!==signature;
 useEffect(()=>{setMapping(JSON.parse(signature));setSaved(false);setError('')},[run.id,signature]);
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false)},[dirty,onDirty]);
 if(!agents.length)return null;
 const editable=run.state==='ready'&&!run.api.cutover;
 const save=async event=>{event.preventDefault();onBusy(true);setError('');setSaved(false);try{const result=await nativeRequest(`${base}/${run.id}/agents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mapping})});onRun(result.data);setSaved(true)}catch(e){setError(e.message)}finally{onBusy(false)}};
 return <div className="move-in-api"><h3>Match source agents to your team</h3><p>Matches by email are suggested automatically. Check each match or leave it as a source author. Deleted agents remain historical authors. Mapping does not invite anyone or grant access, and stays inactive until cutover.</p><Feedback error={error} saved={saved}/><form onSubmit={save}>
  <div className="move-in-agent-list">{agents.map((agent,index)=><div className="form-group" key={agent.id}><label className="form-label" htmlFor={`move-in-agent-${index}`}>{agent.name||`Agent ${agent.id}`}{agent.email&&` (${agent.email})`}{agent.deleted&&' — deleted in source'}</label><select className="form-select" id={`move-in-agent-${index}`} value={mapping[String(agent.id)]??''} disabled={busy||!editable} onChange={event=>{setMapping(old=>({...old,[String(agent.id)]:event.target.value||null}));setSaved(false)}}><option value="">Keep as source author</option>{members.map(member=><option key={member.id} value={String(member.id)}>{member.name||member.email||member.id}{member.name&&member.email?` (${member.email})`:''}</option>)}</select></div>)}</div>
  {editable&&<><p className="settings-note">Save changed matches before approving the import. You can only match people already in this workspace.</p><button className="btn btn-white" disabled={busy||!dirty}>Save agent mapping</button></>}
 </form></div>;
}
