import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../../ui/native/transport';
import {Field,Feedback,Section} from '../../../ui/native/pages/forms';
import './assurance.css';
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const labels={dpa:'Executed DPA',baa:'Executed BAA',subprocessor:'Approved subprocessor / model provider',tenant_isolation:'Tenant isolation',permissions:'Permissions',audit:'Audit',retention:'Retention',recovery:'Recovery',erasure:'Erasure',export:'Export',incident_response:'Incident response',channel_consent:'Channel consent'};
export default function AssurancePage({projectId,role}){
 const base=`/api/assurance/projects/${projectId}`;
 const [data,setData]=useState(null),[profile,setProfile]=useState({partner:'',deployment_ref:'',timezone:'America/New_York'}),[record,setRecord]=useState({kind:'dpa',provider:'',reference:'',valid_from:new Date().toISOString().slice(0,10),expires_at:'',retention_days:0}),[ack,setAck]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const admin=['owner','admin'].includes(role),load=async()=>{const result=(await nativeRequest(base)).data;setData(result);if(result.profile)setProfile(result.profile)};
 useEffect(()=>{if(admin)load().catch(e=>setError(e.message))},[base,admin]);
 const change=(key,value)=>setProfile(old=>({...old,[key]:value})),changeRecord=(key,value)=>setRecord(old=>({...old,[key]:value}));
 const run=async(work,message)=>{setBusy(true);setError('');setNotice('');try{await work();await load();setNotice(message)}catch(e){setError(e.message)}finally{setBusy(false)}};
 if(!admin)return <p role="alert">Only workspace owners and admins can qualify a regulated deployment.</p>;
 return <div className="workspace-settings assurance-page">
  <Feedback error={error}/>{notice&&<p role="status" className="alert alert-success">{notice}</p>}
  <Section title="Regulated deployment" description="Qualify a separate, isolated deployment with your US provider and compliance partner. A self-hosted installation does not supply HIPAA, SOC 2 or FedRAMP assurance.">
   <div className="alert alert-warning" role="status"><strong>Health-data support is not enabled.</strong><p>{data?.activation_blocker||'Executed agreements and independent deployment acceptance are required.'}</p></div>
   {data?.profile?<p>Qualification requested. Native operator, API and widget-session access is on hold. Mail, automation and remaining public doors are not qualified by this preview. Use an isolated deployment with those channels disconnected. Administrators retain qualification, security-log and customer-erasure controls.</p>:<p>Before requesting qualification, export your data and prepare a separate isolated deployment. Requesting qualification places this workspace on a data-access hold. There is currently no remove-hold or health-data activation action.</p>}
   <p>Country: United States · Currency: USD · Recording: disabled</p>
   <form onSubmit={event=>{event.preventDefault();run(()=>nativeRequest(base,json('PUT',{...profile,country:'US',currency:'USD',recording_enabled:false})),'Qualification profile saved. Health-data support remains on hold.')}}><fieldset disabled={busy}>
    <legend className="visually-hidden">Isolated deployment profile</legend>
    <Field name="assurance-partner" label="Qualification partner / provider" value={profile.partner} onChange={(_,value)=>change('partner',value)} required/>
    <Field name="assurance-deployment" label="Isolated deployment reference" value={profile.deployment_ref} onChange={(_,value)=>change('deployment_ref',value)} required hint="Use a non-secret inventory reference. Do not paste credentials or customer data."/>
    <Field name="assurance-timezone" label="IANA calendar timezone" value={profile.timezone} onChange={(_,value)=>change('timezone',value)} required hint="For example, America/New_York. Dates are stored as UTC instants."/>
    {!data?.profile&&<Field name="assurance-ack" label="I understand that requesting qualification places this workspace on a data-access hold." type="checkbox" value={ack} onChange={(_,value)=>setAck(value)}/>}
    <button className="btn btn-primary" disabled={!data?.profile&&!ack}>{data?.profile?'Save qualification profile':'Request qualification and hold data access'}</button>
   </fieldset></form>
  </Section>
  <Section title="Agreements and control evidence" description="Record current, executed agreements and passing receipts from this exact deployment. References point to your controlled evidence store; do not upload health data here. These records prepare independent review and do not certify compliance.">
   <form onSubmit={event=>{event.preventDefault();const status=['dpa','baa'].includes(record.kind)?'executed':record.kind==='subprocessor'?'approved':'passed';run(()=>nativeRequest(base+'/evidence',json('POST',{...record,status,valid_from:new Date(record.valid_from).toISOString(),expires_at:new Date(record.expires_at).toISOString(),settings:{region:'US',model_training:false,baa_covered:true,retention_days:Number(record.retention_days)}})),'Evidence recorded. Independent acceptance remains required.')}}><fieldset disabled={busy}><legend className="visually-hidden">Add qualification evidence</legend>
    <Field name="assurance-kind" label="Agreement or control" options={Object.entries(labels).map(([value,label])=>({value,label}))} value={record.kind} onChange={(_,value)=>changeRecord('kind',value)}/>
    <Field name="assurance-verifier" label="Provider or independent verifier" value={record.provider} onChange={(_,value)=>changeRecord('provider',value)} required/>
    <Field name="assurance-reference" label="Executed agreement or passing receipt URL" type="url" value={record.reference} onChange={(_,value)=>changeRecord('reference',value)} required hint="HTTPS reference without credentials, query or fragment. Verify the linked record before adding it."/>
    <div className="assurance-dates"><Field name="assurance-effective" label="Effective from (UTC)" type="date" value={record.valid_from} onChange={(_,value)=>changeRecord('valid_from',value)} required/><Field name="assurance-expiry" label="Expires on (UTC)" type="date" value={record.expires_at} onChange={(_,value)=>changeRecord('expires_at',value)} required/></div>
    {record.kind==='subprocessor'&&<><p>Only approved US processing, no model training and executed BAA coverage can be recorded. By saving, you confirm these settings in the provider account and agreement.</p><Field name="assurance-provider-retention" label="Provider retention (days)" type="number" min={0} max={3650} value={record.retention_days} onChange={(_,value)=>changeRecord('retention_days',value)} required/></>}
    <button className="btn btn-white">Record verified evidence</button>
   </fieldset></form>
   <ul className="assurance-evidence">{data?.evidence.map(row=><li key={row.id}><strong>{labels[row.kind]}</strong><p>{row.provider} · {row.status}{row.expires_at<=Date.now()?' · expired':''}</p><p>Expires {new Date(row.expires_at).toISOString()} · <a href={row.reference} target="_blank" rel="noopener noreferrer">Open evidence</a></p>{!row.revoked_at&&<button className="btn btn-sm btn-white" type="button" disabled={busy} onClick={()=>run(()=>nativeRequest(base+`/evidence/${row.id}/revoke`,json('POST',{})),'Evidence revoked. Health-data support remains blocked.')}>Revoke {labels[row.kind]}</button>}</li>)}</ul>
  </Section>
  <Section title="Qualification review" description="Missing, expired and revoked evidence stays visible. Native security-log retention and legal holds are configured in Security log.">
   {data?.blockers.length>0?<ul>{data.blockers.map(blocker=><li key={blocker}>{blocker}</li>)}</ul>:<p>Recorded evidence is ready for independent review. Health-data access remains blocked.</p>}
   <p><a href={`/projects/${projectId}/security-log`}>Open security log and retention</a></p>
   <button className="btn btn-white" type="button" disabled={busy} onClick={()=>run(()=>nativeRequest(base+'/activate',json('POST',{})),'')}>Check health-data activation</button>{' '}
   <a className="btn btn-white" href={base+'/report'} download="regulated-deployment-qualification.json">Download qualification record</a>
  </Section>
 </div>;
}
