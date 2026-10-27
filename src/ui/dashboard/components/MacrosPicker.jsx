import React,{useContext,useEffect,useState} from 'react';
import PropTypes from 'prop-types';
import {Link} from '@tanstack/react-router';
import useInboxRoute from '../hooks/useInboxRoute';
import {ChatContext} from '../contexts/ChatContext';
import {nativeRequest} from '../../native/transport';
import MacroPreview from './macros/MacroPreview';
import {referenceSummary} from '../../native/knowledge-references/reference-text';
MacrosPicker.propTypes={onPicked:PropTypes.func,projectId:PropTypes.string};
export default function MacrosPicker({onPicked,projectId}){
 const {urlProjectId}=useInboxRoute(),macrosProjectId=projectId||urlProjectId;
 const {activeConversationId}=useContext(ChatContext);
 const [macros,setMacros]=useState([]),[hasLoaded,setHasLoaded]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[pagination,setPagination]=useState(null),[selected,setSelected]=useState(null),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false);
 const path=`/api/dashboard/projects/${macrosProjectId}/macros`;
 useEffect(()=>{
  const controller=new AbortController();setMacros([]);setHasLoaded(false);setError('');setSelected(null);setPreview(null);
  if(!macrosProjectId)return;
  const timer=setTimeout(()=>nativeRequest(`${path}?${new URLSearchParams({search,page:String(page),sort:'title',direction:'asc'})}`,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted){setMacros(r.data);setPagination(r.pagination);setHasLoaded(true)}}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}),search?200:0);
  return()=>{clearTimeout(timer);controller.abort()};
 },[path,search,page,macrosProjectId]);
 useEffect(()=>{setPage(1);setSearch('');setPreview(null);setSelected(null)},[macrosProjectId,activeConversationId]);
 const result=async(macro,action,body)=>{
  const response=await nativeRequest(`${path}/${macro.id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,version:macro.version})}),item=response.data.results[0];
  if(!['ready','applied','duplicate'].includes(item.status))throw new Error(item.reason||'The macro could not be applied');return item;
 };
 const apply=async(macro=selected,review=preview)=>{
  setBusy(true);setError('');try{
   const item=await result(macro,'apply',{tickets:[{id:review.id,expected_version:review.expected_version}],command_id:crypto.randomUUID()});
   if(item.draft)onPicked?.(item.draft.content,{...item.draft,references:item.references || item.draft.references || [],usage_id:item.usage_id});
   if(item.refresh_error)setError('Macro applied. Reload this ticket to refresh its details.');
   setPreview(null);setSelected(null);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const choose=async macro=>{
  setBusy(true);setError('');try{
   const ticket=await nativeRequest(`/api/dashboard/projects/${macrosProjectId}/conversations/${activeConversationId}/ticket`),review=await result(macro,'preview',{conversation_id:activeConversationId,expected_ticket_version:ticket.data.ticket_version});
   // A plain saved reply keeps its one-click insertion, with its full text shown
   // in the picker. Action macros always open the per-change review first.
   if(!(review.references || review.draft?.references || []).length && Object.keys(macro.actions??{}).every(key=>key==='reply_type')&&(macro.actions.reply_type??'public')==='public')await apply(macro,review);
   else{setSelected(macro);setPreview(review)}
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 if(!macrosProjectId)return null;
 return <div className="saved-replies-picker w-100 mt-2"><ul className="nav nav-tabs nav-tabs-sm border-0 gap-1"><li className="nav-item"><span className="nav-link active">Saved Replies</span></li><li className="nav-item"><Link to={`/projects/${macrosProjectId}/macros`} className="nav-link">Edit Replies <i className="fe fe-external-link"/></Link></li><li className="nav-item"><Link to={`/projects/${macrosProjectId}/macros/create`} className="nav-link">Save a Reply <i className="fe fe-external-link"/></Link></li></ul><div className="mt-3 pt-1 d-flex flex-column"><input className="form-control" type="search" aria-label="Search saved replies" placeholder="Search saved replies" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>{error&&<p role="alert">{error}</p>}{!hasLoaded&&!error&&<p role="status">Loading…</p>}<div className="row saved-replies-picker__results"><div className="col">{macros.map(macro=><div key={macro.id} className="d-inline-block me-2 mt-2 align-top" style={{maxWidth:320}}><button type="button" disabled={busy} className="btn btn-sm btn-white" onClick={()=>choose(macro)}>{macro.title}</button><small className="d-block text-muted text-wrap">{referenceSummary(macro.content)}</small></div>)}{hasLoaded&&macros.length===0&&<div className="text-muted">{search?'No matching replies':'No replies saved'}</div>}</div></div>{preview&&<MacroPreview {...{preview,busy,error}} onApply={()=>apply()} onCancel={()=>{setSelected(null);setPreview(null)}}/>}{pagination&&<nav aria-label="Saved reply picker pages" className="d-flex flex-wrap gap-2 align-items-center mt-3"><button type="button" className="btn btn-sm btn-white" disabled={!hasLoaded||page<=1||busy} onClick={()=>setPage(page-1)}>Previous</button><span role="status">Page {page}</span><button type="button" className="btn btn-sm btn-white" disabled={!hasLoaded||!pagination.hasMore||busy} onClick={()=>setPage(page+1)}>Next</button></nav>}</div></div>;
}
