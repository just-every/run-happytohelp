import React,{useEffect,useId,useState} from 'react';
import {createPortal} from 'react-dom';

// Delegation keeps dynamic icon controls covered without changing their layout.
// Each widget listens inside its own shadow root; workspace hints use the page.
export default function IconHints({scopeRef}){
 const id=useId(),[hint,setHint]=useState(null),[host,setHost]=useState(null);
 useEffect(()=>{
  const scope=scopeRef?.current||document,events=scope.getRootNode(),portal=events instanceof ShadowRoot?events:document.body;
  setHost(portal);let timer,anchor,focused=false;
  const clear=()=>{clearTimeout(timer);if(anchor){const remaining=(anchor.getAttribute('aria-describedby')||'').split(/\s+/).filter(value=>value&&value!==id).join(' ');if(remaining)anchor.setAttribute('aria-describedby',remaining);else anchor.removeAttribute('aria-describedby');}anchor=null;setHint(null);};
  const candidate=event=>{const button=event.target?.closest?.('button,[role="button"],a[aria-label],a[title]');if(!button||!scope.contains(button))return null;const label=button.getAttribute('aria-label')||button.getAttribute('title')||button.querySelector('.sr-only,.visually-hidden')?.textContent?.trim(),copy=button.cloneNode(true);for(const child of copy.querySelectorAll('svg,[aria-hidden="true"],.sr-only,.visually-hidden'))child.remove();return label&&copy.textContent.trim().length<=2?button:null;};
  const show=button=>{if(!button.isConnected)return;const box=button.getBoundingClientRect(),label=button.getAttribute('aria-label')||button.getAttribute('title')||button.querySelector('.sr-only,.visually-hidden')?.textContent?.trim();anchor=button;button.setAttribute('aria-describedby',[button.getAttribute('aria-describedby'),id].filter(Boolean).join(' '));setHint({label,left:Math.max(8,Math.min(innerWidth-228,box.left)),top:box.bottom+8<innerHeight-50?box.bottom+8:Math.max(8,box.top-44)});};
  const enter=event=>{if(event.target?.closest?.('[data-icon-hint]')){clearTimeout(timer);return;}const button=candidate(event);if(!button||button===anchor||focused)return;clear();timer=setTimeout(()=>show(button),300);};
  const leave=event=>{if(focused||event.relatedTarget?.closest?.('[data-icon-hint]'))return;if(candidate(event)||event.target?.closest?.('[data-icon-hint]'))clear();};
  const focus=event=>{const button=candidate(event);clear();focused=!!button;if(button)show(button);};
  const blur=()=>{focused=false;clear();};
  const key=event=>{if(event.key==='Escape')clear();};
  const hide=()=>{focused=false;clear();};
  for(const [name,handler] of [['mouseover',enter],['mouseout',leave],['focusin',focus],['focusout',blur],['keydown',key],['click',hide]])events.addEventListener(name,handler);
  window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
  return()=>{clear();for(const [name,handler] of [['mouseover',enter],['mouseout',leave],['focusin',focus],['focusout',blur],['keydown',key],['click',hide]])events.removeEventListener(name,handler);window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);};
 },[id,scopeRef]);
 return hint&&host?createPortal(<span id={id} role="tooltip" data-icon-hint="" style={{position:'fixed',left:hint.left,top:hint.top,zIndex:2147483647,maxWidth:220,padding:'6px 9px',borderRadius:5,background:'#172033',color:'#fff',font:'13px/1.4 Arial, sans-serif',whiteSpace:'normal',boxShadow:'0 2px 6px #0003'}}>{hint.label}</span>,host):null;
}
