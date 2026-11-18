import React, {useContext, useEffect, useState, useRef, useLayoutEffect} from 'react';
import AppContext from './context/AppContext';
import RequestFormLink from './RequestFormLink';
import ChatHeader from './ChatHeader';
import ChatList from './ChatList';
import SendMessage from './SendMessage';
import ConversationWelcome from './ConversationWelcome';
import ConnectionNotice from './ConnectionNotice';
import ChatUnavailable from './ChatUnavailable';
import AwayNotice from './AwayNotice';
import ResolutionRating from './ResolutionRating';
import MonitoringConsent from './MonitoringConsent';



import log from "./includes/log";

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
    faTimes as falTimes,
} from "@fortawesome/free-solid-svg-icons";
import { v4 as uuidv4 } from 'uuid';
import {ConnectContext} from "./context/ConnectContext";
import { tooltip } from '../../tooltip/tooltip';



export default function Interact({ setOpen }) {
    const context = useContext(AppContext);
    const isPreview = context.preview?.enabled === true;
    const {
        open,
        assertConnected,
        contactAuth,
        sendMessage,
        conversationId,
        setFilteredMessages,
        mainView,
        setMainView,
        messages,
        agentTyping,
        thinking,
        localContact,
        setLocalContact,
        contact,
        setContact,
        connectErrors,
        connectionState,
        uploadMedia
    } = useContext(ConnectContext);
    const [ errors, setErrors ] = useState([]);
    const unavailable = !isPreview && !messages.some(message=>message.contact_id) && ['interrupted','offline'].includes(connectionState);
    const nodeRefChatList = useRef(null);
    const [ headerExpanded, setHeaderExpanded ] = useState(false);
    const [ headerExpandedAnimate, setHeaderExpandedAnimate ] = useState(false);
    const [headerHeight,setHeaderHeight]=useState(null);
    const [ showing, setShowing ] = useState(false);

    const sendContact = (state) => {
        setErrors([]);
        if(state.provided_name && state.provided_name !== (localContact.provided_name ?? localContact.name)) {
            setContact({ ...contact, loading_name: true });
        }
        if(state.provided_email && state.provided_email !== (localContact.provided_email ?? localContact.email)) {
            setContact({ ...contact, loading_email: true });
        }
        setLocalContact({ ...contact, ...state });
    }

    const displayError = (messages, settings = {}) => {
        if(!Array.isArray(messages)) messages = [ messages ];
        if(settings.debug) settings.debug = JSON.stringify(settings.debug);
        log.error(messages, settings);
        if(settings.clear) {
            setErrors(messages);
        }
        else {
            setErrors(errors => [ ...errors, ...messages ]);
        }
    }

    const onSend = async (content, files) => {
        const data = {content, contact, media_ids: [], local_id: uuidv4(), contact_id: contactAuth.id};
        const localMessage = {...data, media: [], sending: true, uploading_media: files};
        setFilteredMessages([localMessage]);
        setErrors([]);
        try {
            await assertConnected();
            data.media_ids = await Promise.all(files.map(async file => (await uploadMedia(file)).data.id));
            await sendMessage('sendMessage', data);
        } catch(error) {
            displayError(error.message || 'Could not send message');
            setFilteredMessages([{...localMessage, ...data, failed_send: true}]);
        }
    };

    useEffect(() => {
        setErrors(connectErrors);
    }, [ connectErrors ]);

    useEffect(() => {
        // run as an effect to ensure it animates correctly
        setShowing(open);
    }, [open]);

    useLayoutEffect(() => {
        // run as an effect to ensure it animates correctly
        if(headerExpanded) {
            setHeaderExpandedAnimate(true);
        }
        else {
            window.setTimeout(() => {
                setHeaderExpandedAnimate(false);
            }, 300);
        }
    }, [headerExpanded]);

    let containerClass = ["happytohelp-interact-container"];
    if(showing && thinking) containerClass.push("happytohelp-thinking");

    let overlayClass = ["happytohelp-content-overlay"];
    if(headerExpanded) {
        overlayClass.push("happytohelp-content-overlay-show");
    }
    if(headerExpandedAnimate) {
        overlayClass.push("happytohelp-content-overlay-animate");
    }

    return (
        <div className={containerClass.join(" ")} style={headerHeight!==null?{"--happytohelp-header-height":`${headerHeight}px`}:undefined}>
            <div className="happytohelp-interact" onClick={() => {
                headerExpanded && setHeaderExpanded(false)
            }}>
                <ChatHeader unavailable={unavailable} onHeightChange={setHeaderHeight} setOpen={setOpen} headerExpanded={headerExpanded} setHeaderExpanded={setHeaderExpanded}/>
                <div className={overlayClass.join(" ")}/>
                <div
                    className={"happytohelp-content" + (mainView === 'conversation' ? " happytohelp-content-full" : "")}>
                    <ConnectionNotice />
                    {unavailable ? <ChatUnavailable/> : <><RequestFormLink/><AwayNotice /></>}
                    {!isPreview && !unavailable && <MonitoringConsent />}
                    <div className="happytohelp-chatlist-container" ref={nodeRefChatList} role="region" aria-label="Conversation transcript" tabIndex={0}>
                        {!unavailable && <ConversationWelcome empty={!messages.length} />}
                        <ChatList messages={messages} contact={contact} sendContact={sendContact}
                                  scrollRef={nodeRefChatList} agentTyping={agentTyping}/>
                        <ResolutionRating/>
                    </div>
                    {!unavailable && errors.map((error, index) =>
                        <div key={"error-" + index} className="happytohelp-error" role="alert">
                            <span>{error}</span>
                            <button type="button" className="happytohelp-error-close" { ...tooltip('Dismiss message') } onClick={() => {
                            setErrors(errors => errors.splice(index, 1) && [...errors])
                        }}>
                                <FontAwesomeIcon icon={falTimes} className="happytohelp-show-opened" aria-hidden="true" />
                            </button>
                        </div>
                    )}
                    {!unavailable && <SendMessage mainView={mainView} setView={() => {
                        setMainView('conversation')
                    }} messages={messages} localContact={localContact} contact={contact} sendContact={sendContact}
                                 onSend={onSend} displayError={displayError}/>}
                </div>
            </div>
        </div>
    );
}
