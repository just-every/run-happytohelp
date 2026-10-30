import React, {useContext, useRef, useState, useLayoutEffect} from 'react';

import Media from './Media';
import { parseISO, formatRelative, differenceInMinutes } from 'date-fns';
import ModalPreview from './ModalPreview';
import ChatMessage from './ChatMessage';
import ChatStatus from './ChatStatus';
import TypingIndicator from "./TypingIndicator";
import AgentAvatar from "./AgentAvatar";
import {ConnectContext} from "./context/ConnectContext";
import AppContext from "./context/AppContext";

const SEPERATE_MESSAGE_MINUTES = 5;

export default function ChatList({ messages, contact, sendContact, scrollRef, agentTyping }) {
    const context = useContext(AppContext);
    const {
        open,
        getCurrentAgent
    } = useContext(ConnectContext);
    const chatListEl = useRef(null);
    const groupEls = useRef([]);
    const footerEl = useRef(null);
    const topIndexes = useRef({});
    const [previewFile, setPreviewFile] = useState(false);
    const [showingChunked, setShowingChunked] = useState(false);
    const [chatHeight, setChatHeight] = useState(0);

    let lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const currentAgent = getCurrentAgent();

    agentTyping = agentTyping || {};
    if(lastMessage && lastMessage.chunked && lastMessage.agent_id === agentTyping.agent?.id) {
        agentTyping.typing = false;
    }

    const expandBase = (agentTyping.typing && lastMessage) || lastMessage?.chunked || lastMessage?.chunked_complete || lastMessage?.sending || lastMessage?.sending_complete;

    let groups = [];
    let lastGroup = null;
    let sending = [];
    let sendingComplete = [];
    let lastMessageCreated = null;
    messages.forEach((message, index) => {
        if(message.sending) {
            sending.push(message);
        }
        if(message.sending_complete) {
            sendingComplete.push(message);
        }

        const messageCreated = parseISO(message.created_at);
        const seperate = !lastMessageCreated || differenceInMinutes(messageCreated, lastMessageCreated) > SEPERATE_MESSAGE_MINUTES;
        lastMessageCreated = messageCreated;

        let group = message.contact_id || message.agent_id;
        if(!seperate && lastGroup === group) {
            groups[groups.length - 1].push(message);
        }
        else {
            groups.push([message]);
        }
        lastGroup = group;
    });

    const topIndex = groups.length - (agentTyping.typing ? 0 : 1);

    const scrollToBottom = () => {
        if(scrollRef.current !== null) {
            const { scrollHeight, offsetHeight, scrollTop } = scrollRef.current;
            const { height: viewHeight } = scrollRef.current.getBoundingClientRect();
            scrollRef.current.scroll({
                top: scrollHeight,
                behavior: (scrollHeight - offsetHeight - scrollTop) < (viewHeight * 3) ? 'smooth' : 'instant',
            });
        }
    };

    useLayoutEffect(() => {
        let viewHeight = 0;
        let minHeight = 0;
        if(scrollRef?.current) {
            const { height } = scrollRef.current.getBoundingClientRect();
            viewHeight = height;
            minHeight = height;
        }
        if(!viewHeight) return;

        let heightTop = 0;
        let lastUsed = -1;
        for(let index = topIndex - 1; index > -1 && index > (groupEls.current.length - 5); --index) {
            if(!groupEls.current[index]) break;

            let { height } = groupEls.current[index].getBoundingClientRect();
            if(topIndexes.current[topIndex]) {
                if(index >= topIndexes.current[topIndex]) {
                    heightTop += height; // We know we used this index before - stops jumping around
                }
                else {
                    break;
                }
            }
            else {
                if((heightTop + height) <= (viewHeight/2)) {
                    heightTop += height; // Keep as many groups in view as possible
                    lastUsed = index;
                    if(groups[index][0].insight && groups[index][0].agent_id) {
                        // If we have an insight message, put it at the top
                        break;
                    }
                }
                else {
                    break;
                }
            }
        }
        if(!topIndexes.current[topIndex] && lastUsed > -1) topIndexes.current[topIndex] = lastUsed;
        minHeight -= heightTop;

        if(footerEl?.current) {
            const { height: footerHeight } = footerEl.current.getBoundingClientRect();
            minHeight -= footerHeight;
        }

        if(minHeight > 0) setChatHeight(minHeight);
    }, [topIndex, messages, scrollRef, agentTyping]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        if(lastMessage?.chunked) {
            if(lastMessage?.chunked_complete) {
                setShowingChunked(false);
            }
            else if(!showingChunked) {
                setShowingChunked(true);
                // First time showing a chunked message
                scrollToBottom();
            }
        }
        else {
            if(showingChunked) {
                setShowingChunked(false);
            }
            scrollToBottom();
        }
    }, [topIndex, chatHeight, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        if(open) {
            scrollToBottom();
        }
    }, [open, currentAgent]); // eslint-disable-line react-hooks/exhaustive-deps

    const lastGroupStyle = expandBase ? {
        minHeight: chatHeight+"px",
    } : null;

    let lastGroupDate = null;
    let thisGroupDate = null;
    let wroteNewDate = false;

    const ucFirst = (str) => {
        return str[0].toUpperCase() + str.slice(1).toLowerCase();
    };

    const showAgentName = (agent, groupIndex, newDate = false) => {
        if(!agent?.first_name && !agent?.name) return null;

        // A historical AI reply keeps its disclosure when the header switches
        // to a human. The current responder is not every message's author.
        let show = !!agent.is_ai;
        if(groupIndex > 0) {
            if(newDate) {
                show = true;
            }
            else {
                let lastAgentIndex = groupIndex - 1;
                while(lastAgentIndex >= 0) {
                    if(groups[lastAgentIndex][0].agent) {
                        break;
                    }
                    lastAgentIndex--;
                }
                if(lastAgentIndex >= 0 && groups[lastAgentIndex][0].agent.id !== agent.id) {
                    show = true;
                }
            }
        }
        else if(currentAgent.id !== agent.id) {
            show = true;
        }

        if(show) {
            return <div className="happytohelp-chat-agent-name happytohelp-text-muted"><span>{agent.first_name ?? agent.name}</span>{agent.is_ai && <small className="happytohelp-ai-disclosure">AI assistant</small>}</div>;
        }

        return null;
    }

    if (!currentAgent) return null;

    return (<>
        <ModalPreview
            previewFile={previewFile}
            hide={() => setPreviewFile(false)}
            containerRef={chatListEl}
        />
        <div ref={chatListEl} className="happytohelp-chat-list" style={ context.theme.window }>

            {!groups.length > 0 && <div className={"happytohelp-chat-local happytohelp-chat-list-no-groups"}>
                { currentAgent.is_ai && context.text.ai.chat && <div className={"happytohelp-info-header happytohelp-text-muted"}>
                    { context.text.ai.chat }
                </div> }
            </div>}
            {groups.map((groupMessages, groupIndex) => (
                <div ref={(element) => groupEls.current[groupIndex] = element}
                     key={groupMessages[0].local_id || groupMessages[0].id}
                     className={(groupMessages[0].contact_id ? 'happytohelp-chat-local' : 'happytohelp-chat-agent')}
                     style={groupIndex === topIndex ? lastGroupStyle : null}>
                    { groupIndex === 0 && currentAgent.is_ai && context.text.ai.chat && <div className={"happytohelp-info-header happytohelp-text-muted"}>
                        { context.text.ai.chat }
                    </div> }
                    {wroteNewDate = false}
                    {(thisGroupDate = parseISO(groupMessages[0].created_at)) && (Math.abs(differenceInMinutes(thisGroupDate, lastGroupDate ?? new Date())) > SEPERATE_MESSAGE_MINUTES) && (!lastGroupDate || formatRelative(thisGroupDate, new Date()) !== formatRelative(lastGroupDate, new Date())) &&
                        <div className={"happytohelp-chat-group-time happytohelp-text-muted"}>
                            {wroteNewDate = true}
                            {ucFirst(formatRelative(thisGroupDate, new Date()))}
                        </div>
                    }
                    <div className="happytohelp-chat-group">
                        {groupMessages[0].agent && <AgentAvatar agent={groupMessages[0].agent}/>}
                        <div className='happytohelp-chat-group-messages'>
                            { showAgentName(groupMessages[0].agent, groupIndex, wroteNewDate) }
                            {groupMessages.map((message, messageIndex) => (
                                <div key={message.local_id || message.id}
                                     className={"happytohelp-chat-box-container"}>

                                    <ChatMessage message={message}
                                                 moveHeight={groupIndex === topIndex ? chatHeight : 0}>
                                        {message.uploading_media ?
                                            message.uploading_media.map((media, mediaIndex) => (
                                                <Media key={mediaIndex} upload={true} media={media}
                                                       setPreview={setPreviewFile}/>
                                            )) :
                                            message.media?.map(media => (
                                                <Media key={media.id} upload={false} media={media}
                                                       setPreview={setPreviewFile}/>
                                            ))}
                                    </ChatMessage>
                                </div>
                            ))}
                        </div>
                    </div>
                    {(lastGroupDate = thisGroupDate) && null}
                    <ChatStatus isLast={groupIndex === groups.length - 1}
                                message={groupMessages[groupMessages.length - 1]}
                                agentTyping={agentTyping}></ChatStatus>
                </div>
            ))}
            {agentTyping.typing &&
                <div key="typing-indicator" className="happytohelp-chat-agent" style={lastGroupStyle}>
                    <div className="happytohelp-chat-group">
                    {agentTyping.agent && <AgentAvatar agent={agentTyping.agent}/>}
                        <div className='happytohelp-chat-group-messages'>
                            { showAgentName(agentTyping.agent, groups.length)}
                            <div
                                className="happytohelp-chat-box happytohelp-chat-box-agent happytohelp-chat-has-content" style={ context.theme.chat.agent }>
                                <TypingIndicator agentTyping={ agentTyping }/>
                            </div>
                        </div>

                    </div>
                </div>
            }
            <div ref={footerEl}>
                <div className="happytohelp-chat-clear"/>
            </div>
        </div>
    </>);
};
