import React,{useEffect,useId,useState} from 'react';
import {createPortal} from 'react-dom';

// While a voice surface is open, its surrounding icon controls also have help.
// Existing labelled controls and controls with their own description are untouched.
export default function VoiceTooltips(){
 const id=useId(),[tip,setTip]=useState(null);
 useEffect(()=>{
  let timer,target,title,description;
  const hide=()=>{clearTimeout(timer);if(target){if(title!==null)target.setAttribute('title',title);if(target.getAttribute('aria-describedby')===id){if(description===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',description);}}target=null;setTip(null);};
  const enter=event=>{
   const control=event.target.closest?.('button,a[href],summary');
   if(!control||control.disabled||control.getAttribute('aria-describedby')||control.innerText?.trim()&&!control.classList.contains('native-profile-toggle'))return;
   const text=control.getAttribute('title')||control.getAttribute('aria-label');if(!text)return;
   if(target===control&&event.type!=='focusin')return;hide();target=control;title=control.getAttribute('title');description=control.getAttribute('aria-describedby');control.removeAttribute('title');
   const show=()=>{if(control.getAttribute('aria-describedby')&&control.getAttribute('aria-describedby')!==id){hide();return;}const rect=control.getBoundingClientRect();control.setAttribute('aria-describedby',id);setTip({text,left:Math.max(8,Math.min(rect.left,innerWidth-228)),top:rect.bottom+8>innerHeight-50?Math.max(8,rect.top-46):rect.bottom+8});};
   if(event.type==='focusin')show();else timer=setTimeout(show,300);
  };
  const leave=event=>{if(target&&(!event.relatedTarget||!target.contains(event.relatedTarget)))hide();};
  const key=event=>{if(event.key==='Escape')hide();};
  document.addEventListener('mouseover',enter);document.addEventListener('focusin',enter);document.addEventListener('mouseout',leave);document.addEventListener('focusout',leave);document.addEventListener('keydown',key);window.addEventListener('scroll',hide,true);
  return()=>{hide();document.removeEventListener('mouseover',enter);document.removeEventListener('focusin',enter);document.removeEventListener('mouseout',leave);document.removeEventListener('focusout',leave);document.removeEventListener('keydown',key);window.removeEventListener('scroll',hide,true);};
 },[id]);
 return tip?createPortal(<span id={id} role="tooltip" style={{position:'fixed',left:tip.left,top:tip.top,zIndex:13000,maxWidth:220,padding:'6px 10px',borderRadius:6,background:'#111',color:'#fff',fontSize:14,lineHeight:1.4,pointerEvents:'none'}}>{tip.text}</span>,document.body):null;
}
