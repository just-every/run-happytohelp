import React,{useContext,useEffect,useState} from 'react';
import {nativeRequest} from './transport';
import {ChatContext} from '../dashboard/contexts/ChatContext';
/** Summary › Investigate, only while a Slate client is connected. The native edition supplies only its real case URL; Slate owns its private inquiry context. */
export default function SlateInquiryLink({conversation}) {
 const [clients,setClients]=useState(null),[error,setError]=useState('');
 const {takeInitialInboxRead,initialInboxReadsId}=useContext(ChatContext);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setClients(null);setError('');
  const request=takeInitialInboxRead
   ? takeInitialInboxRead('connections',conversation.id,conversation.project_id,{signal:controller.signal,initialInboxRead:true})
      .then(initial=>initial?initial.result:nativeRequest(`/api/delegation/connections?projectId=${encodeURIComponent(conversation.project_id)}`,{signal:controller.signal}))
   : nativeRequest(`/api/delegation/connections?projectId=${encodeURIComponent(conversation.project_id)}`,{signal:controller.signal});
  request.then(r=>{if(active)setClients(r.clients)}).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false;controller.abort()};
 },[conversation.project_id,conversation.id,initialInboxReadsId,takeInitialInboxRead]);
 if(!error&&!clients?.length)return null;
 const sourceUrl=typeof window==='undefined'?'':`${window.location.origin}/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}`;
 return <div className="ticket-summary__row ticket-summary__row--slate"><dt>Investigate</dt><dd>{error?<p role="alert">{error}</p>:clients.map(client=><p key={client.id}><a href={`${client.origin}/app/resolve?sourceUrl=${encodeURIComponent(sourceUrl)}`}>Investigate with Slate{clients.length>1?` in ${client.id}`:''}</a></p>)}<p className="ticket-summary__note">A separate connected app for investigating customer problems. Replies remain in HappyToHelp. Slate requests permission before reading this case.</p></dd></div>;
}
