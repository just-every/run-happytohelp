import React, {useRef,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Field,Feedback,Section} from '../forms';
const tools=['search_knowledge','read_knowledge_source','cite_knowledge','read_conversation_entry','read_conversation_history','search_conversation_history','propose_followup','list_followup_dependencies'];
const initial={key:'refund-advice',intent:'refund',instructions:'',model:'',humanEscalation:'',maxCost:1,maxTokens:1000,tools:['search_knowledge','read_knowledge_source','cite_knowledge']};
export default function ProcedureSettings({projectId,runs,onEvaluate}){
 const base=`/api/ai-support/projects/${projectId}/procedures`,[catalog,setCatalog]=useState(null),[draft,setDraft]=useState(initial),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[reason,setReason]=useState(''),[evaluationId,setEvaluationId]=useState(''),[limit,setLimit]=useState(1),[conversationId,setConversationId]=useState(''),[revoke,setRevoke]=useState('search_knowledge'),[report,setReport]=useState(null),epoch=useRef(0),pending=useRef(false);
 React.useEffect(()=>()=>{epoch.current++;},[]);
 const action=async work=>{if(pending.current)return;pending.current=true;const current=epoch.current;setBusy(true);setError('');setNotice('');try{await work(current);}catch(e){if(current===epoch.current)setError(e.message);}finally{pending.current=false;if(current===epoch.current)setBusy(false);}};
 const load=async current=>{const data=await nativeRequest(base);if(current===epoch.current)setCatalog(data);return data;};
 const post=(path,body)=>nativeRequest(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const version=catalog?.versions.find(v=>v.id===selected),release=catalog?.releases.find(r=>r.version_id===selected&&r.state==='active');
 const choose=id=>{setSelected(id);setPreview(null);setReport(null);setEvaluationId('');};
 const field=(name,label,props={})=><Field name={'procedure-'+name} label={label} value={draft[name]} onChange={(_,value)=>setDraft(d=>({...d,[name]:value}))} {...props}/>;
 const create=event=>{event.preventDefault();action(async current=>{const result=await post(`/${encodeURIComponent(draft.key)}/versions`,{intent:draft.intent,instructions:draft.instructions,model:draft.model,config:{tools:draft.tools,humanEscalation:draft.humanEscalation,maxCost:Number(draft.maxCost),maxTokens:Number(draft.maxTokens)}});await load(current);if(current===epoch.current){choose(result.id);setNotice('Immutable procedure version created. Evaluate this exact version before release.');}});};
 const review=state=>action(async current=>{await post(`/${version.procedure_key}/versions/${version.id}/review`,{state,reason});if(current===epoch.current)setNotice(`Review recorded: ${state}.`);});
 const rollout=(suffix,body)=>action(async current=>{await post(`/${version.procedure_key}/releases${suffix}`,body);await load(current);if(current===epoch.current)setNotice('Rollout change recorded. Existing evidence is retained.');});
 return <details className="settings-section procedure-settings"><summary>Advice procedures</summary>
  <p>Version the advice and read-only tools your assistant may use. Refunds and other business actions still require a person; these procedures cannot grant payment authority.</p>
  <Feedback error={error}/>{notice&&<p role="status">{notice}</p>}
  <button type="button" className="btn btn-white" disabled={busy} onClick={()=>action(load)}>{busy?'Loading procedures…':'Load procedures'}</button>
  {catalog&&<>
   <form aria-label="Create procedure version" onSubmit={create}><Section title="Draft a procedure" description="Saving creates a new immutable version. Existing conversations keep their original version.">
    {field('key','Procedure key',{required:true})}{field('intent','Intent',{required:true})}{field('instructions','Procedure instructions',{type:'textarea',required:true})}{field('model','Procedure model',{required:true})}{field('humanEscalation','Human escalation rule',{type:'textarea',rows:2,required:true})}
    <fieldset><legend>Permitted tools</legend>{tools.map(tool=><Field key={tool} name={'procedure-tool-'+tool} label={tool} type="checkbox" value={draft.tools.includes(tool)} onChange={(_,checked)=>setDraft(d=>({...d,tools:checked?[...d.tools,tool]:d.tools.filter(t=>t!==tool)}))}/>)}</fieldset>
    <div className="settings-grid">{field('maxCost','Procedure evaluation budget (USD)',{type:'number',min:0.01,max:1000,step:'any',required:true})}{field('maxTokens','Procedure output token limit',{type:'number',min:1,max:32000,required:true})}</div>
    <button className="btn btn-primary" disabled={busy}>Create procedure version</button>
   </Section></form>
   <Section title="Review and release">
    <Field name="procedure-selected-version" label="Procedure version" value={selected} onChange={(_,id)=>choose(id)} options={[{value:'',label:'Choose a version'},...catalog.versions.map(v=>({value:v.id,label:`${v.procedure_key} · version ${v.version}`}))]}/>
    {version&&<>
     <p>{version.instructions}</p><p>Escalation: {version.config.humanEscalation}</p>
     <button type="button" className="btn btn-white" disabled={busy} onClick={()=>onEvaluate(version)}>Use version in evaluation form</button>{' '}
     <button type="button" className="btn btn-white" disabled={busy} onClick={()=>action(async current=>{const data=await nativeRequest(`${base}/${version.procedure_key}/versions/${version.id}/replay-preview`);if(current===epoch.current)setPreview(data);})}>Inspect cited replay cases</button>
     {preview&&<div aria-label="Historical replay preview"><p>{preview.privacyDefault}</p>{preview.expectedEffect&&<p>Expected effect: {preview.expectedEffect}</p>}{!preview.cases.length&&<p>This version cites no historical failure cases.</p>}{preview.cases.map(item=><details key={item.resolutionId}><summary>Cited {item.reopened?'reopened':'negative-feedback'} case</summary><a href={`/projects/${projectId}/conversations/${item.conversationId}`}>Open source conversation</a>{item.messages.map(m=><p key={m.evidenceId}>{m.content}</p>)}</details>)}</div>}
     <Field name="procedure-review-reason" label="Review reason" value={reason} onChange={(_,value)=>setReason(value)} type="textarea" rows={2}/>
     <button type="button" className="btn btn-white" disabled={busy||!reason.trim()} onClick={()=>review('rejected')}>Reject version</button>{' '}<button type="button" className="btn btn-white" disabled={busy||!reason.trim()} onClick={()=>review('approved')}>Approve version review</button>
     <Field name="procedure-evaluation" label="Exact-version evaluation" value={evaluationId} onChange={(_,value)=>setEvaluationId(value)} options={[{value:'',label:'Choose a completed evaluation'},...(runs||[]).filter(r=>r.config?.procedureVersionId===version.id&&r.status==='completed').map(r=>({value:r.id,label:`${r.kind} · ${r.case_count} cases · ${new Date(r.created_at).toLocaleString()}`}))]}/>
     <Field name="procedure-cohort-limit" label="Maximum conversations in rollout" value={limit} onChange={(_,value)=>setLimit(value)} type="number" min={1} max={100}/>
     <button type="button" className="btn btn-primary" disabled={busy||!evaluationId||!!release} onClick={()=>rollout('',{versionId:version.id,evaluationId,cohortLimit:Number(limit)})}>Approve bounded rollout</button>
     {release&&<>
      <p>Active rollout: at most {release.cohort_limit} explicitly enrolled conversations. Approval does not enroll or hand back a conversation automatically.</p>
      <Field name="procedure-conversation" label="Conversation ID to enroll" value={conversationId} onChange={(_,value)=>setConversationId(value)}/>
      <button type="button" className="btn btn-white" disabled={busy||!conversationId.trim()} onClick={()=>rollout(`/${release.id}/cohort`,{conversationId})}>Enroll conversation</button>
      <Field name="procedure-revoke-tool" label="Tool to revoke" value={revoke} onChange={(_,value)=>setRevoke(value)} options={version.config.tools.map(t=>({value:t,label:t}))}/>
      <button type="button" className="btn btn-white" disabled={busy} onClick={()=>rollout(`/${release.id}/revoke-tool`,{tool:revoke})}>Revoke tool</button>{' '}<button type="button" className="btn btn-white" disabled={busy} onClick={()=>rollout(`/${release.id}/stop`,{})}>Stop rollout</button>
     </>}
     <button type="button" className="btn btn-link" disabled={busy} onClick={()=>action(async current=>{const data=await nativeRequest(`/api/ai-support/projects/${projectId}/procedure-reports/${version.procedure_key}`);if(current===epoch.current)setReport(data);})}>Inspect procedure outcomes</button>
     {report&&<div aria-label="Procedure outcomes"><p>{report.attribution}</p>{report.versions.map(v=><p key={v.versionId}>Version {v.version}: {v.reopened}/{v.denominator} resolution cycles reopened; {v.negativeCsat}/{v.rated} rated cycles negative.</p>)}{report.cases.map(item=><p key={item.resolutionId}><a href={`/projects/${projectId}/conversations/${item.conversationId}`}>Supporting case, version {item.version}</a></p>)}<p>{report.priceData==='unavailable'?'Price data unavailable':`Provider estimate: $${report.providerCostEstimateUsd} USD`}</p>{report.nextOffset!==null&&<p>More cases are available in the conversation’s production trace report.</p>}</div>}
    </>}
   </Section>
  </>}
 </details>;
}
