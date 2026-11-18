import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../transport';

export default function HelpCenterLink({projectId}) {
 const [data,setData]=useState(null),[slug,setSlug]=useState(''),[feedback,setFeedback]=useState(''),[error,setError]=useState('');
 const path=`/api/public-site/projects/${projectId}/alias`;
 useEffect(()=>{let active=true;nativeRequest(path).then(value=>{if(active){setData(value);setSlug(value.slug||value.suggested);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path]);
 const url=`${window.location.origin}/help/${encodeURIComponent(data?.slug||projectId)}`;
 const save=async()=>{setError('');try{const value=await nativeRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug})});setData(current=>({...current,slug:value.slug}));setFeedback('Address saved.');}catch(e){setError(e.message);}};
 return <div className="help-center-address"><p><a href={url} target="_blank" rel="noreferrer">Open your help center</a>{' '}<button type="button" className="btn btn-white btn-sm" onClick={async()=>{try{await navigator.clipboard.writeText(url);setFeedback('Address copied.');}catch{setError('Could not copy the address. Open the link to copy it from your browser.');}}}>Copy address</button></p>
  {data?.slug?<p>{window.location.origin}/help/{data.slug}</p>:data?.canManage&&<div className="form-group"><label className="form-label" htmlFor="help-center-readable-address">Your help center address</label><div className="d-flex flex-wrap gap-2 align-items-center"><span>/help/</span><input className="form-control" style={{width:'auto',minWidth:0,maxWidth:'100%'}} id="help-center-readable-address" value={slug} onChange={e=>setSlug(e.target.value)} maxLength={100}/><button type="button" className="btn btn-white" onClick={save}>Save address</button></div></div>}
  {feedback&&<p role="status">{feedback}</p>}{error&&<p role="alert">{error}</p>}
 </div>;
}
