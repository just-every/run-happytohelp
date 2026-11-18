import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../transport';
export default function LocalMailBanner({projectId}) {
 const [local,setLocal]=useState(false);
 useEffect(()=>{let active=true;nativeRequest(`/api/management/projects/${projectId}/widget-addresses`).then(value=>{if(active)setLocal(value.mailMode==='local');}).catch(()=>{});return()=>{active=false;};},[projectId]);
 return local?<aside className="alert alert-info" role="status">Email is off on this computer, so no emails are sent or received. Chat works.</aside>:null;
}
