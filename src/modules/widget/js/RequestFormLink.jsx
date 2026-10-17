import React, {useContext, useEffect, useState} from 'react';
import AppContext from './context/AppContext';

/** Opens the workspace's published forms; the form owns its separate email proof. */
export default function RequestFormLink() {
 const {apiOrigin,widgetKey,preview}=useContext(AppContext);
 const [projectId,setProjectId]=useState(null);
 useEffect(()=>{
  if(preview?.enabled||!widgetKey||!apiOrigin)return;
  const controller=new AbortController();
  (async()=>{
   const settings=await fetch(`${apiOrigin}/api/widget/settings?widgetKey=${encodeURIComponent(widgetKey)}`,{signal:controller.signal,credentials:'omit'});
   if(!settings.ok)throw new Error('Request form settings unavailable');
   const {projectId:workspace}=await settings.json();
   const response=await fetch(`${apiOrigin}/api/forms/${encodeURIComponent(workspace)}`,{signal:controller.signal,credentials:'omit'});
   if(!response.ok)throw new Error('Request forms unavailable');
   const value=await response.json();if(Array.isArray(value.data)&&value.data.length>0)setProjectId(workspace);
  })().catch(error=>{if(error.name!=='AbortError')console.error('Could not load request forms');});
  return()=>controller.abort();
 },[apiOrigin,widgetKey,preview?.enabled]);
 if(!projectId)return null;
 return <div className="happytohelp-request-form-link"><a href={`${apiOrigin}/help/${encodeURIComponent(projectId)}/requests?source=widget`} target="_blank" rel="noopener noreferrer">Submit a request form</a></div>;
}
