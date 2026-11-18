import React, {useContext} from 'react';
import AppContext from './context/AppContext';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faComment, faTimes} from '@fortawesome/free-solid-svg-icons';
import {tooltip} from '../../tooltip/tooltip';

export default function Button(props) {
 const context=useContext(AppContext);
 return <button type="button" className={`happytohelp-button happytohelp-icon${props.customize?' happytohelp-customize':''}${props.open?' happytohelp-open':''}`} onMouseOver={props.onMouseOver} onClick={props.onClick} {...tooltip(props.open?'Close chat':'Open chat','left')} aria-expanded={props.open} style={props.open?context.theme.button.open:context.theme.button.closed}>
  <FontAwesomeIcon icon={faComment} flip="horizontal" className="happytohelp-show-closed"/>
  <FontAwesomeIcon icon={faTimes} className="happytohelp-show-opened"/>
 </button>;
}
