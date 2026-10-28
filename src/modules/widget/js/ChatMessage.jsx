import React, {useLayoutEffect, useRef, useState, useEffect, useContext} from 'react';
import ReactMarkdown from "h2h-widget-markdown";
import gfm from "h2h-widget-gfm";
import externalLinks from "h2h-widget-external-links";

import MessageCitations from './MessageCitations';
import {visibleMessageContent} from '../../conversations/citations.js';
import AppContext from "./context/AppContext";

const unavailableKnowledge = '[Knowledge unavailable]';

// Wrap text nodes after Markdown parsing so mixed paragraphs, emphasis and
// links retain their existing structure. All inserted content stays text.
function mutedKnowledgeNotices() {
    return tree => {
        const visit = node => {
            if (!Array.isArray(node.children)) return;
            node.children = node.children.flatMap(child => {
                if (child.type === 'text' && child.value.includes(unavailableKnowledge)) {
                    return child.value.split(unavailableKnowledge).flatMap((part, index) => [
                        ...(index ? [{type: 'element', tagName: 'span', properties: {className: ['happytohelp-knowledge-unavailable']}, children: [{type: 'text', value: unavailableKnowledge}]}] : []),
                        ...(part ? [{type: 'text', value: part}] : []),
                    ]);
                }
                visit(child);
                return [child];
            });
        };
        visit(tree);
    };
}

// Check if a message only contains image media
function onlyContainsImages(message) {
    if (message.content) return false;

    let hasContent = false;
    (message.uploading_media ?? (message.media ?? [])).forEach(media => {
        if(!media.isImage && media.aggregate_type !== 'image') {
            hasContent = true;
        }
    });

    return !hasContent;
}

export default function ChatMessage({ children: media, message, moveHeight = 0 }) {
    const context = useContext(AppContext);
    const expand = Boolean(message.chunked || message.chunked_complete);
    const messageRef = useRef(null);
    const [messageStyle, setMessageStyle] = useState(expand ? { height: '23px' } : {});
    const [previousHeight, setPreviousHeight] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    const [atBottom, setAtBottom] = useState(false);
    const [moveUp, setMoveUp] = useState(message.contact_id && message.sending && moveHeight > 0 ? moveHeight : 0);

    useLayoutEffect(() => {
        if (expand && !isAnimating && !atBottom) {
            if(previousHeight === 0) {
                setPreviousHeight(messageRef.current.offsetHeight);
            }
            else {
                const newHeight = messageRef.current.scrollHeight;
                const heightDifference = Math.abs(newHeight - previousHeight);
                if (heightDifference > 0) {
                    const speed = Math.max(300, Math.min(500, heightDifference*10)); // Pixels per second
                    const transitionDuration = heightDifference / speed;

                    setMessageStyle({
                        height: `${newHeight}px`,
                        transition: `height ${transitionDuration}s linear`
                    });
                    setPreviousHeight(newHeight);
                    setIsAnimating(true);
                }
                else if(!isAnimating && message.chunked_complete) {
                    // A fixed streaming height makes scrollHeight unable to report a later Markdown reflow
                    // that is shorter. Return to natural height once the completed reply is stable.
                    setMessageStyle({});
                    setAtBottom(true);
                }
            }
        }
    }, [message.content, message.chunked_complete, atBottom, expand, previousHeight, isAnimating]);

    useEffect(() => {
        if(expand && !atBottom) {
            const handleAnimationEnd = () => {
                setIsAnimating(false);
            };

            const currentRef = messageRef.current;
            if (currentRef) {
                currentRef.addEventListener('transitionend', handleAnimationEnd);
            }

            return () => {
                if (currentRef) {
                    currentRef.removeEventListener('transitionend', handleAnimationEnd);
                }
            };
        }
    }, [messageRef, expand, atBottom]);

    useEffect(() => {
        // This will set the animation state after the component mounts
        if(moveUp > 0) {
            setMoveUp(0);
        }
    }, [moveUp]);

    let containerClasses = ["happytohelp-chat-box"];
    if(message.contact_id) {
        containerClasses.push("happytohelp-chat-box-local");
    }
    else {
        containerClasses.push("happytohelp-chat-box-agent");
    }
    if(message.content) {
        containerClasses.push("happytohelp-chat-box-has-content");
    }
    if(onlyContainsImages(message)) {
        containerClasses.push("happytohelp-chat-box-image-only");
    }

    let messageClasses = ["happytohelp-chat-message"];
    if(expand) {
        messageClasses.push("happytohelp-chat-message-expanding");
    }
    if(moveUp) {
        messageClasses.push("happytohelp-chat-message-move");
    }

    let fadeClasses = ["happytohelp-chat-message-fade"];
    if(!message.chunked_complete || isAnimating) {
        fadeClasses.push("happytohelp-chat-message-fade-show");
    }

    let style = structuredClone( message.contact_id ? context.theme.chat.user : context.theme.chat.agent );
    if(moveUp) {
        style.top = context.theme.chat.user;
    }

    return (
        <div className={containerClasses.join(" ")} style={ style }>
            { media }
            <div ref={messageRef} className={messageClasses.join(" ")} style={ messageStyle }>
                {expand && <div className={fadeClasses.join(" ")}></div> }
                <ReactMarkdown remarkPlugins={[gfm, externalLinks]} rehypePlugins={[mutedKnowledgeNotices]}>{visibleMessageContent(message.content)}</ReactMarkdown>
                <MessageCitations message={message} />
            </div>
        </div>
    );
}
