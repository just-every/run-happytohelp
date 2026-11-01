import {useEffect,useState} from 'react';
import {nativeRequest} from '../../native/transport';

export default function useNewTicketChoices(projectId,requesterId) {
 const [state,setState]=useState({projectId:null,options:null,mailboxes:null,error:''});
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  setState({projectId,options:null,mailboxes:null,error:''});
  const base=`/api/dashboard/projects/${encodeURIComponent(projectId)}/tickets/options`;
  Promise.all([nativeRequest(base+(requesterId?`?requesterId=${encodeURIComponent(requesterId)}`:''),{signal:controller.signal}),nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/mailboxes`,{signal:controller.signal})]).then(([options,mail])=>{if(active)setState({projectId,options,mailboxes:mail.data.filter(row=>row.status==='connected'),error:''});}).catch(failure=>{if(active)setState({projectId,options:null,mailboxes:[],error:failure.message});});
  return ()=>{active=false;controller.abort();};
 },[projectId,requesterId]);
 return state.projectId===projectId?state:{projectId,options:null,mailboxes:null,error:''};
}
