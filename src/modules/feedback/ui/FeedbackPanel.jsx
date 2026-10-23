import PennyConnection from './PennyConnection';
import PennyHandoff from './PennyHandoff';
import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../../ui/native/transport';
import {useCan} from '../../../ui/dashboard/components/ConversationAccess';
import {Field,Feedback} from '../../../ui/native/pages/forms';
import './feedback.css';
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export default function FeedbackPanel({projectId,conversationId,refreshKey,active}){
 return <FeedbackBody key={conversationId} {...{projectId,conversationId,refreshKey,active}}/>;
}
function FeedbackBody({projectId,conversationId,refreshKey,active}){
 const base=`/api/feedback/projects/${projectId}`,path=base+`/conversations/${conversationId}`;
 const manage=useCan(projectId,'conversations.manage'),reply=useCan(projectId,'conversations.reply'),install=useCan(projectId,'integrations.install');
 const [data,setData]=useState({data:[],updates:[]}),[messages,setMessages]=useState([]),[settings,setSettings]=useState(null),[form,setForm]=useState({message_id:'',penny_url:'',issue_url:''}),[consent,setConsent]=useState({}),[drafts,setDrafts]=useState({}),[secret,setSecret]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{const [records,transcript,connection]=await Promise.all([nativeRequest(path),nativeRequest(`/api/conversations/${conversationId}/messages`),install?nativeRequest(base+'/settings'):null]);setData(records);setMessages((transcript.messages||[]).filter(m=>m.actor_role==='contact'&&!m.erased_at));setSettings(connection?.data);};
 useEffect(()=>{if(!active)return;let live=true;load().catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[path,refreshKey,active,install]);
 const run=async(work,message)=>{setBusy(true);setError('');setNotice('');try{await work();await load();setNotice(message)}catch(e){setError(e.message)}finally{setBusy(false)}};
 const change=(name,value)=>setForm(previous=>({...previous,[name]:value}));
 const choices=[{value:'',label:'Choose a customer message'},...messages.map(m=>({value:m.id,label:m.content?.slice(0,110)||'Empty message'}))];
 return <div className="feedback-panel" aria-busy={busy}>
  <p>Keep the selected customer quote with its Penny request and engineering delivery. Penny owns the roadmap; your team owns the customer response.</p>
  <Feedback error={error}/>{notice&&<p role="status">{notice}</p>}
  <button type="button" className="btn btn-sm btn-white" disabled={busy} onClick={()=>run(async()=>{},'Feedback refreshed.')}>Refresh feedback</button>
  {data.data.map(source=><article key={source.id} className="feedback-source" aria-label="Linked customer feedback">
   <blockquote>{source.quote}</blockquote>{source.account_name&&<p>Account: {source.account_name}</p>}
   <p><a href={source.penny_url} target="_blank" rel="noopener noreferrer">Penny request</a> · <a href={source.issue_url} target="_blank" rel="noopener noreferrer">Engineering delivery</a></p>
   {manage&&<PennyHandoff path={path} source={source} messages={messages} onChanged={load}/>}
   <p>Service updates: {source.subscribed?'Subscribed':'Off'}. Recovery is unconfirmed.</p>
   {manage&&<>{!source.subscribed&&<Field name={`feedback-consent-${source.id}`} label="Requester consent message" options={choices} value={consent[source.id]||''} onChange={(_,value)=>setConsent(old=>({...old,[source.id]:value}))} hint="Select the requester's explicit permission to receive this service update. A quote alone is not consent."/>}
    <button type="button" className="btn btn-sm btn-white" disabled={busy||!source.subscribed&&!consent[source.id]} onClick={()=>run(()=>nativeRequest(path+`/sources/${source.id}/preference`,json('PUT',{subscribed:!source.subscribed,preference_message_id:consent[source.id]})),source.subscribed?'Requester opted out.':'Requester subscribed.')}>{source.subscribed?'Opt out of service updates':'Subscribe requester'}</button></>}
   {data.updates.filter(update=>update.source_id===source.id).map(update=><div className="feedback-update" key={update.id}>
    {['draft','approved'].includes(update.state)?<><Field name={`feedback-update-${update.id}`} label="Requester update preview" type="textarea" value={drafts[update.id]??update.content} onChange={(_,value)=>setDrafts(old=>({...old,[update.id]:value}))}/>
     <p>This sends on the original conversation's permitted channel. It keeps the request open and does not verify recovery.</p>
     {reply&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>run(async()=>{const frontier=await nativeRequest(`/api/conversations/${conversationId}`);await nativeRequest(path+`/updates/${update.id}/send`,json('POST',{content:drafts[update.id]??update.content,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id}));},'Approved update saved. Check its delivery in the conversation.')}>Approve and send service update</button>}</>:<p>Service update: {update.state}</p>}
   </div>)}
  </article>)}
  {manage&&<details className="feedback-capture"><summary>Link customer feedback</summary><form onSubmit={event=>{event.preventDefault();run(()=>nativeRequest(path,json('POST',form)),'Source-linked feedback saved.')}}>
   <fieldset disabled={busy}><legend className="visually-hidden">Link customer feedback</legend>
    <Field name="feedback-message" label="Supporting customer quote" value={form.message_id} options={choices} onChange={(_,value)=>change('message_id',value)} required/>
    <Field name="feedback-penny" label="Penny request URL" type="url" value={form.penny_url} onChange={(_,value)=>change('penny_url',value)} required hint="Create or find the request in Penny, then link it here. No private notes are shared automatically."/>
    <Field name="feedback-issue" label="Vector or issue tracker URL" type="url" value={form.issue_url} onChange={(_,value)=>change('issue_url',value)} required/>
    <button className="btn btn-primary">Save feedback link</button>
   </fieldset></form></details>}
  {install&&<PennyConnection base={base}/>}
  {install&&<details className="feedback-connection"><summary>Release connection</summary><p>Use a trusted release sender. Configure its signing secret separately; only the signature is accepted here.</p>
   {settings&&<><p>{settings.connected?'Release sender connected.':'No release sender connected.'}</p><p>Release receiver: <code>{settings.release_url}</code></p></>}
   <form onSubmit={event=>{event.preventDefault();run(async()=>{await nativeRequest(base+'/settings',json('PUT',{secret}));setSecret('')},'Release signing secret saved.')}}><Field name="feedback-secret" label="Release signing secret" type="password" value={secret} onChange={(_,value)=>setSecret(value)} required/><button className="btn btn-white" disabled={busy}>Save release connection</button></form>
   {settings?.connected&&<button type="button" className="btn btn-white" disabled={busy} onClick={()=>run(()=>nativeRequest(base+'/settings',json('PUT',{revoke:true})),'Release sender revoked.')}>Revoke release connection</button>}
  </details>}
 </div>;
}
