import React,{useLayoutEffect,useRef} from 'react';
import WidgetAddressNotice from './WidgetAddressNotice';

/** Reserve the notice's actual height above the inbox's viewport-sized panes. */
export default function InboxWidgetNotice({projectId}) {
 const ref=useRef(null);
 useLayoutEffect(()=>{
  const element=ref.current,root=element.parentElement;
  const measure=()=>root.style.setProperty('--widget-address-notice-height',`${element.getBoundingClientRect().height}px`);
  measure();const observer=new ResizeObserver(measure);observer.observe(element);
  return()=>{observer.disconnect();root.style.removeProperty('--widget-address-notice-height');};
 },[]);
 return <div ref={ref} className="inbox-widget-notice"><WidgetAddressNotice projectId={projectId}/></div>;
}
