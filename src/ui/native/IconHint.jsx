import React, {Children, cloneElement, useCallback, useEffect, useId, useRef, useState} from 'react';
import Overlay from 'react-bootstrap/Overlay';
import Tooltip from 'react-bootstrap/Tooltip';

/** A visual name for icon controls: delayed pointer hover, immediate focus.
 * Clone the control so navigation layout, its real ref and event handlers survive. */
export default function IconHint({children, label}) {
    const child=Children.only(children), target=useRef(null), timer=useRef(null), focused=useRef(false), hovered=useRef(false), id=useId();
    const [show,setShow]=useState(false), childRef=child.props.ref;
    const ref=useCallback(node=>{target.current=node;if(typeof childRef==='function')childRef(node);else if(childRef)childRef.current=node;},[childRef]);
    const clear=()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}};
    useEffect(()=>()=>clear(),[]);
    return <>{cloneElement(child,{
        ref,
        'aria-describedby':[child.props['aria-describedby'],show?id:null].filter(Boolean).join(' ')||undefined,
        onMouseEnter:event=>{child.props.onMouseEnter?.(event);hovered.current=true;clear();timer.current=setTimeout(()=>setShow(true),300);},
        onMouseLeave:event=>{child.props.onMouseLeave?.(event);hovered.current=false;clear();if(!focused.current)setShow(false);},
        onFocus:event=>{child.props.onFocus?.(event);focused.current=true;clear();setShow(true);},
        onBlur:event=>{child.props.onBlur?.(event);focused.current=false;clear();if(!hovered.current)setShow(false);},
        onKeyDown:event=>{child.props.onKeyDown?.(event);if(event.key==='Escape'){clear();setShow(false);}},
        onClick:event=>{clear();setShow(false);child.props.onClick?.(event);},
    })}<Overlay target={target.current} show={show} placement="bottom" flip transition={false}>{props=><Tooltip {...props} id={id}>{label}</Tooltip>}</Overlay></>;
}
