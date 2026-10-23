import React,{useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Field,Feedback} from '../forms';
const initial={conversationId:'',resolutionId:'',messageId:'',categoryId:'',title:'',quote:''};
export default function KnowledgeProposals({projectId,categories}){
 const base=`/api/knowledge/${projectId}`,[data,setData]=useState(null),[sources,setSources]=useState(null),[gaps,setGaps]=useState(null),[draft,setDraft]=useState(initial),[selected,setSelected]=useState(''),[edit,setEdit]=useState({title:'',content:'',slug:'',redactionReviewed:false}),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),epoch=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{epoch.current++;},[]);
 const work=async fn=>{if(pending.current)return;pending.current=true;const current=epoch.current;setBusy(true);setError('');setNotice('');try{await fn(current);}catch(e){if(current===epoch.current)setError(e.message);}finally{pending.current=false;if(current===epoch.current)setBusy(false);}};
 const load=async current=>{try{const [proposals,topics,available]=await Promise.all([nativeRequest(base+'/proposals'),nativeRequest(base+'/gaps'),nativeRequest(base+'/proposals/sources')]);if(current===epoch.current){setData(proposals);setGaps(topics);setSources(available);}return proposals;}catch(error){if(current===epoch.current){setData(null);setGaps(null);setSources(null);}throw error;}};
 const choose=(id,rows=data?.proposals||[])=>{setSelected(id);const proposal=rows.find(p=>p.id===id);setEdit({title:proposal?.title||'',content:proposal?.content||'',slug:'',redactionReviewed:false});setReason('');};
 const source=sources?.cases.find(c=>c.resolutionId===draft.resolutionId),sourceMessage=source?.messages.find(m=>m.id===draft.messageId);
 const proposal=data?.proposals.find(p=>p.id===selected);
 const post=(path,body)=>nativeRequest(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const field=(name,label,props={})=><Field name={'knowledge-proposal-'+name} label={label} value={draft[name]} onChange={(_,value)=>setDraft(d=>({...d,[name]:value}))} {...props}/>;
 const create=event=>{event.preventDefault();work(async current=>{const result=await post('/proposals',{...draft,sourceMessageOnly:true}),rows=await load(current);if(current===epoch.current){choose(result.id,rows.proposals);setNotice(result.state==='published'?'This source already has reviewed published guidance.':'Private draft prepared. It is not published.');}});};
 const review=(suffix,body)=>work(async current=>{await post(`/proposals/${proposal.id}/${suffix}`,body);await load(current);if(current===epoch.current)setNotice(suffix==='publish'?'Edited private guidance published by you.':suffix==='reject'?'Rejection retained for review.':'Correction proposals updated; published guidance is unchanged.');});
 return <section className="knowledge-form knowledge-proposals"><h2>Review knowledge proposals</h2>
  <p>Turn a verified support resolution into a private draft. Masking assists review; a named editor must check every publication for personal data and appropriate scope.</p>
  <Feedback error={error}/>{notice&&<p role="status">{notice}</p>}
  <button type="button" className="btn btn-white" disabled={busy} onClick={()=>work(load)}>{busy?'Loading proposals…':'Load proposals and gaps'}</button>
  {data&&<>
   <p>{data.publicationDefault}</p>
   <details><summary>Knowledge gaps</summary>
    <ul>{gaps?.searchTopics.map((topic,i)=><li key={i}>{topic.topic} · {topic.locale} · {topic.occurrences} searches without results</li>)}</ul>
    <ul>{gaps?.reopenedCases.map(item=><li key={item.resolutionId}><a href={`/projects/${projectId}/conversations/${item.conversationId}`}>Reopened source case</a></li>)}</ul>
    <ul>{gaps?.procedureFailures?.map(item=><li key={item.generationId}><a href={`/projects/${projectId}/conversations/${item.conversationId}`}>{item.procedureKey}: {item.category}</a> · locale unavailable</li>)}</ul>
    {gaps?.nextOffset!==null&&<p>Additional gaps are available through the paginated knowledge gaps API.</p>}
   </details>
   <form aria-label="Prepare knowledge proposal" onSubmit={create}><h3>Prepare a sourced draft</h3>
    <Field name="knowledge-verified-source" label="Verified source case" required value={draft.resolutionId} onChange={(_,id)=>{const selected=sources.cases.find(c=>c.resolutionId===id);setDraft(d=>({...d,resolutionId:id,conversationId:selected?.conversationId||'',messageId:'',categoryId:''}));}} options={[{value:'',label:'Choose a resolved case with positive customer feedback'},...(sources?.cases||[]).map(c=>({value:c.resolutionId,label:`${c.subject} · ${c.customerName} · ${new Date(c.resolvedAt).toLocaleString()}`}))]}/>
    {sources?.nextOffset!==null&&<button type="button" className="btn btn-white" disabled={busy} onClick={()=>work(async current=>{const next=await nativeRequest(`${base}/proposals/sources?offset=${sources.nextOffset}`);if(current===epoch.current)setSources(prior=>({...next,cases:[...new Map([...prior.cases,...next.cases].map(c=>[c.resolutionId,c])).values()]}));})}>More verified cases</button>}
    {source&&<>
     <p><a href={`/projects/${projectId}/conversations/${source.conversationId}`}>Review source conversation</a></p>
     {source.unavailableReason&&<p role="status">{source.unavailableReason}</p>}
     <Field name="knowledge-source-message" label="Resolution evidence" required value={draft.messageId} onChange={(_,id)=>setDraft(d=>({...d,messageId:id}))} options={[{value:'',label:'Choose the exact source message'},...source.messages.map(m=>({value:m.id,label:`${m.role==='contact'?'Customer':'Teammate'}: ${m.preview.slice(0,120)}`}))]}/>
     {sourceMessage&&<blockquote>{sourceMessage.preview}</blockquote>}
    </>}
    {field('categoryId','Private destination collection',{required:true,options:[{value:'',label:'Choose the source customer’s domain collection'},...(categories||[]).filter(c=>source?.privateCollectionIds.includes(c.id)).map(c=>({value:c.id,label:c.title||c.name}))]})}
    {field('title','Proposed article title',{required:true})}
    <p>The source must be resolved with positive customer feedback. This creates source-language guidance only; translations need a separate editor review.</p>
    <button className="btn btn-primary" disabled={busy||!sourceMessage||!draft.categoryId}>Prepare private draft</button>
   </form>
   <Field name="knowledge-selected-proposal" label="Knowledge proposal" value={selected} onChange={(_,id)=>choose(id)} options={[{value:'',label:'Choose a proposal'},...data.proposals.map(p=>({value:p.id,label:`${p.title} · ${p.state}`}))]}/>
   {proposal&&<div aria-label="Knowledge proposal review">
    <p>Scope: {proposal.source_domain} · {proposal.locale}. State: {proposal.state}.</p>
    <p><a href={`/projects/${projectId}/conversations/${proposal.conversation_id}`}>Open cited source conversation</a></p>
    <p>Source cycle: <code>{proposal.resolution_id}</code>; source message: <code>{proposal.message_id}</code>.</p>
    <Field name="knowledge-review-title" label="Reviewed article title" value={edit.title} onChange={(_,value)=>setEdit(e=>({...e,title:value}))}/>
    <Field name="knowledge-review-content" label="Reviewed article content" type="textarea" value={edit.content} onChange={(_,value)=>setEdit(e=>({...e,content:value}))}/>
    <Field name="knowledge-review-slug" label="Published article slug" value={edit.slug} onChange={(_,value)=>setEdit(e=>({...e,slug:value}))}/>
    <Field name="knowledge-redaction-reviewed" label="I reviewed personal data and the private publication scope" type="checkbox" value={edit.redactionReviewed} onChange={(_,value)=>setEdit(e=>({...e,redactionReviewed:value}))}/>
    <button type="button" className="btn btn-primary" disabled={busy||!edit.redactionReviewed||!edit.title.trim()||!edit.content.trim()} onClick={()=>review('publish',{...edit,...(!edit.slug?{slug:undefined}:{})})}>Publish reviewed private guidance</button>
    <Field name="knowledge-reject-reason" label="Editorial rejection reason" type="textarea" rows={2} value={reason} onChange={(_,value)=>setReason(value)}/>
    <button type="button" className="btn btn-white" disabled={busy||!reason.trim()||proposal.state==='published'} onClick={()=>review('reject',{reason})}>Reject draft</button>
    <p>{proposal.outcomes.citedResolutionCycles} cited resolution cycles; {proposal.outcomes.reopened} reopened. {proposal.outcomes.verifiedRecovery}</p>
    {proposal.correctionRequired&&<p role="status">A source or cited customer cycle reopened. Corrective review is required.</p>}
    <button type="button" className="btn btn-white" disabled={busy} onClick={()=>review('analyze-corrections',{})}>Analyze corrective proposals</button>
    <p>Retained corrective proposals: {proposal.corrections.length}.</p>
    <ul aria-label="Editorial decisions">{proposal.reviews.map((r,i)=><li key={i}>{r.state}: {r.reason}</li>)}</ul>
   </div>}
  </>}
 </section>;
}
