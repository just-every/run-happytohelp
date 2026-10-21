import React,{useEffect,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {nativeRequest} from '../../native/transport';
import './EmailComposer.css';

/** The email follow-up links of one ticket: the closed ticket it follows up, and the tickets that follow it up. */
export function useEmailFollowups(projectId,conversationId){
 const [links,setLinks]=useState([]),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setLinks([]);setError('');nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/email-followups`,{signal:controller.signal}).then(result=>setLinks(result.data)).catch(failure=>{if(!controller.signal.aborted)setError(failure.message)});return()=>controller.abort()},[projectId,conversationId]);
 return {links,error};
}

export function EmailFollowupLink({projectId,conversationId,link}){
 const parent=link.conversation_id===conversationId,target=parent?link.parent_id:link.conversation_id;
 return <>{parent?'Follow-up to closed ticket: ':'Follow-up ticket: '}<Link to={`/projects/${projectId}/conversations/${target}`}>{link.subject||target}</Link></>;
}

export default function EmailFollowups({projectId,conversationId}){
 const {links,error}=useEmailFollowups(projectId,conversationId);
 if(error)return <p className="px-3 text-danger" role="alert">Could not load linked follow-ups: {error}</p>;
 if(!links.length)return null;
 return <nav className="email-followup-links px-3 py-2 border-bottom" aria-label="Email follow-up tickets">{links.map(link=><p className="mb-1" key={link.conversation_id}><EmailFollowupLink projectId={projectId} conversationId={conversationId} link={link}/></p>)}</nav>;
}
