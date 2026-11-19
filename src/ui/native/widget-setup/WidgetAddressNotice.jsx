import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../transport';
import {setupStore} from '../activation/setup-store';
import {useConfirmation} from '../pages/ConfirmDialog';

export default function WidgetAddressNotice({projectId}) {
 const [address,setAddress]=useState(null),[error,setError]=useState(''),[canManage,setCanManage]=useState(false);
 const {ask,dialog}=useConfirmation(),path=`/api/management/projects/${projectId}/widget-addresses`;
 useEffect(()=>{let active=true;const load=()=>{if(projectId)nativeRequest(path).then(value=>{if(active){setAddress(value.address);setCanManage(value.canManage);setError('');}}).catch(e=>{if(active)setError(e.message);});};load();window.addEventListener('focus',load);return()=>{active=false;window.removeEventListener('focus',load);};},[path,projectId]);
 if(!projectId)return null;
 const allow=()=>ask({title:'Allow this website address?',confirmLabel:'Allow this address',busyLabel:'Allowing…',body:<><p>Chat will also work on {address}. Your other allowed addresses will stay on the list.</p><p>Only allow addresses of websites you run.</p></>,run:async()=>{await nativeRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address})});setAddress(null);void setupStore(projectId).refreshWebsiteAddresses();}});
 return <>{address&&<aside className="alert alert-warning" role="status" style={{overflowWrap:'anywhere'}}>Chat refused a visit from {address} because it is not on your allowed list. {canManage?<button type="button" className="btn btn-white" onClick={allow}>Allow this address</button>:<span>Ask a workspace owner to allow this address.</span>}</aside>}{error&&<p role="alert">{error}</p>}{dialog}</>;
}
