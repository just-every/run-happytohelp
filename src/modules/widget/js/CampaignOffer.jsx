import React,{useContext,useEffect,useRef,useState} from 'react';
import {ConnectContext} from './context/ConnectContext';
import AppContext from './context/AppContext';
export default function CampaignOffer(){
 const {monitoring,open,sendMessage,conversationSettings}=useContext(ConnectContext),context=useContext(AppContext);
 const [offer,setOffer]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const prepare=useRef(context.prepareCampaign);prepare.current=context.prepareCampaign;
 const entered=useRef(Date.now()),exitIntent=useRef(false),offered=useRef(false),path=useRef(location.pathname);
 const enabled=context.settings.collector.enabled!==false&&monitoring?.enabled===true&&conversationSettings.campaignsEnabled===true;
 useEffect(()=>{if(!enabled){setOffer(null);}},[enabled]);
 useEffect(()=>{
  if(!enabled||open||offered.current)return;
  let active=true,pending=false,timer;
  const key=`rer-campaign-visit:${context.apiOrigin}:${context.widgetKey}`;
  let visitId;
  try{visitId=sessionStorage.getItem(key);if(!visitId){visitId=crypto.randomUUID();sessionStorage.setItem(key,visitId);}}catch{return;}
  const evaluate=async()=>{
   if(!active||pending||offered.current||document.hidden)return;
   const elapsedSeconds=Math.min(86400,(Date.now()-entered.current)/1000);
   if(elapsedSeconds<(conversationSettings.campaignsStartAfter||0)){clearTimeout(timer);timer=setTimeout(evaluate,(conversationSettings.campaignsStartAfter-elapsedSeconds)*1000);return;}
   pending=true;
   try{
    const height=document.documentElement.scrollHeight-window.innerHeight;
    const result=await sendMessage('campaignEvaluate',{visitId,path:location.pathname.slice(0,500),elapsedSeconds,scrollPercent:height>0?Math.min(100,Math.max(0,window.scrollY/height*100)):0,exitIntent:exitIntent.current,...(Number.isFinite(context.campaignContext?.cartValue)?{cartValue:context.campaignContext.cartValue}:{})});
    if(active&&result?.offer){prepare.current?.();offered.current=true;setOffer(result.offer);}
   }catch{}finally{pending=false;}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(evaluate,300);};
  const exit=event=>{if(event.clientY<=0&&!event.relatedTarget){exitIntent.current=true;schedule();}};
  const delay=Math.max(0,(conversationSettings.campaignsStartAfter||0)*1000-(Date.now()-entered.current));
  timer=setTimeout(evaluate,delay);
  const interval=setInterval(evaluate,15000);
  const navigation=setInterval(()=>{if(path.current!==location.pathname){path.current=location.pathname;entered.current=Date.now();exitIntent.current=false;evaluate();}},1000);
  window.addEventListener('scroll',schedule,{passive:true});document.addEventListener('mouseout',exit);window.addEventListener('popstate',schedule);
  return()=>{active=false;clearTimeout(timer);clearInterval(interval);clearInterval(navigation);window.removeEventListener('scroll',schedule);document.removeEventListener('mouseout',exit);window.removeEventListener('popstate',schedule);};
 },[enabled,open,sendMessage,conversationSettings.campaignsStartAfter,context.campaignContext?.cartValue]);
 // Count display after the card is actually committed, rather than counting every reservation as an impression.
 useEffect(()=>{if(!offer||!enabled||open)return;sendMessage('campaignEvent',{id:offer.id,event:'show'}).then(result=>{if(!result?.accepted)setOffer(null);}).catch(()=>{});},[offer?.id,enabled,open,sendMessage]);
 const choose=async event=>{setBusy(true);setError('');try{const result=await sendMessage('campaignEvent',{id:offer.id,event});setOffer(null);if(event==='open'&&result?.accepted)context.openCampaign?.();}catch(e){setError(e.message);}finally{setBusy(false);}};
 if(!offer||!enabled||open)return null;
 return <section className="happytohelp-campaign" aria-label="Help before you ask"><strong>{offer.sender}</strong><div>{offer.brand}</div><p>{offer.message}</p><div className="happytohelp-campaign-actions"><button type="button" disabled={busy} onClick={()=>choose('open')}>Open chat</button><button type="button" disabled={busy} onClick={()=>choose('dismiss')}>Dismiss</button></div>{error&&<p role="alert">{error}</p>}</section>;
}
