import React,{useContext,useEffect,useState} from 'react';
import AppContext from './context/AppContext';

export default function ChatUnavailable() {
 const {apiOrigin,widgetKey}=useContext(AppContext),[contactUrl,setContactUrl]=useState(null);
 useEffect(()=>{const controller=new AbortController();fetch(`${apiOrigin}/api/widget/contact-route?widgetKey=${encodeURIComponent(widgetKey)}`,{signal:controller.signal,credentials:'omit'}).then(r=>r.ok?r.json():{}).then(value=>{if(value.contactUrl){const url=new URL(value.contactUrl);if(['http:','https:'].includes(url.protocol))setContactUrl(url.href);}}).catch(()=>{});return()=>controller.abort();},[apiOrigin,widgetKey]);
 return <div className="happytohelp-connection-state" role="status"><p>Chat is unavailable right now.</p>{contactUrl?<p><a href={contactUrl} target="_blank" rel="noopener noreferrer">Contact support</a></p>:<p>Please try again later.</p>}</div>;
}
