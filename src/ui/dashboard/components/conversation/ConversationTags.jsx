import React,{useContext,useState} from 'react';
import {ChatContext} from '../../contexts/ChatContext';
import {nativeRequest} from '../../../native/transport';

/** Summary › Tags: each tag removes in place; a new one is typed in place and added. */
export default function ConversationTags({conversation,onChanged}){
 const {updateConversation}=useContext(ChatContext),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),path=`/api/dashboard/projects/${conversation.project_id}/conversations/${conversation.id}/tags`;
 const change=async(tag)=>{
  setBusy(true);setError('');
  try{
   const result=tag
    ?await nativeRequest(`${path}/${tag.id}`,{method:'DELETE'})
    :await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
   // Adopt this save's confirmed version in the Summary as well as the conversation.
   // The next edit still sends expected_version and refuses an intervening change.
   if(onChanged)onChanged(result.ticket);else updateConversation(conversation.id,result.ticket);
   if(!tag)setName('');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <div className="conversation-tags-row"><div className="conversation-tags">{(conversation.tags||[]).map(tag=><button type="button" className="conversation-tag" key={tag.id} disabled={busy} aria-label={`Remove tag ${tag.name}`} onClick={()=>change(tag)}>{tag.name} ×</button>)}</div><form className="conversation-tags-form" onSubmit={e=>{e.preventDefault();change()}}><input aria-label="New tag" placeholder="+ Add tag" className="form-control form-control-sm" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><button className="btn btn-sm btn-white" disabled={busy||!name.trim()}>Add</button></form>{error&&<p role="alert" className="text-danger">{error}</p>}</div>
}
