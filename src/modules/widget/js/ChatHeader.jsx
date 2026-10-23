import React, {useContext, useLayoutEffect, useRef, useState} from 'react';


import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faAngleDown, faAngleUp} from "@fortawesome/free-solid-svg-icons";
import AgentAvatar from "./AgentAvatar";
import {ConnectContext} from "./context/ConnectContext";
import AppContext from "./context/AppContext";
import {faTimes as falTimes} from "@fortawesome/free-solid-svg-icons";
import {backAt} from "../availability-text.js";
import { tooltip } from '../../tooltip/tooltip';
export default function ChatHeader({ setOpen, headerExpanded, setHeaderExpanded, onHeightChange}) {
    const context = useContext(AppContext);
    const {
        thinking,
        conversationSettings,
        setConversationSettings,
        sendMessage,
        getCurrentAgent,
    } = useContext(ConnectContext);

    const contentEl = useRef(null);
    const responderToggleRef = useRef(null);
    const [lastHeight, setLastHeight] = useState(0);

    const currentAgent = getCurrentAgent();
    // A person replies within the usual time only while the team is available.
    const availability = conversationSettings?.availability;
    const humanResponse = availability?.available === false ? (availability.opensAt ? context.text.away.header_back.replace('{when}', backAt(availability.opensAt)) : context.text.away.header) : context.text.ai.human_response;
    const canExpand = conversationSettings && (conversationSettings.ais.length + (conversationSettings.is_human_response_enabled ? 1 : 0)) > 1;
    if(!canExpand && headerExpanded) {
        headerExpanded = false;
    }

    const handleAgentChange = (event, agent) => {
        event.preventDefault();
        setHeaderExpanded(false);
        const aiId = agent.is_ai ? agent.id : null;
        if(aiId !==  conversationSettings.ai_id) {
            setConversationSettings({ ...conversationSettings, ai_id: aiId });
            sendMessage('assignAi', { ai_id: aiId });
        }
    }

    const handleHeaderKeyDown = event => {
        if(event.key !== 'Escape' || !headerExpanded) return;
        event.preventDefault();
        setHeaderExpanded(false);
        window.requestAnimationFrame(() => responderToggleRef.current?.focus());
    };

    const activateWithKeyboard = (event, action) => {
        if(event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        action(event);
    };

    useLayoutEffect(() => {
        const element = contentEl.current;
        if (!element) return;
        // Layout height excludes the entrance animation scale. Header and body
        // must reserve the same space throughout that animation.
        const measure = () => {const height = element.offsetHeight;setLastHeight(height);onHeightChange?.(height);};
        measure();const observer = new ResizeObserver(measure);observer.observe(element);
        return () => observer.disconnect();
    }, [headerExpanded, onHeightChange, context.brand?.logo_url, context.brand?.name, !!currentAgent]);


    let content;
    if(headerExpanded) {
        let agents = [];
        conversationSettings.ais.forEach((aiAgent) => {
            let agent = structuredClone(aiAgent);
            agent.ai = aiAgent;
            agent.is_ai = true;
            agents.push(agent);
        });
        if(conversationSettings.is_human_response_enabled) {
            agents.push(conversationSettings.human);
        }

        let agentRows = [];
        agents.forEach((agent, index) => {
            agentRows.push(<div key={index} className={"happytohelp-chat-header-agent"+(currentAgent.id === agent.id ? " happytohelp-chat-header-agent-active" : "")} role="button" tabIndex={0} aria-pressed={currentAgent.id === agent.id} onClick={(event) => handleAgentChange(event, agent)} onKeyDown={event => activateWithKeyboard(event, action => handleAgentChange(action, agent))}>
                <AgentAvatar agent={ agent } />
                <div className="happytohelp-insight-agent">
                    <div>
                        <span className="happytohelp-insight-agent-name">{agent.first_name ?? agent.name}</span>
                        <span className="happytohelp-insight-agent-seperator">•</span>
                        <span className="happytohelp-insight-agent-role">{agent.role ?? (agent.is_ai ? context.text.ai.ai : context.text.ai.human)}</span>
                    </div>
                    <div className="happytohelp-insight-agent-info">{agent.is_ai ? context.text.ai.ai_response : humanResponse}</div>
                </div>
            </div>);
        });

        content = (
            <div className="happytohelp-chat-header-title-agents" style={ context.theme.window }>
                <div className="happytohelp-chat-header-desc" role="button" tabIndex={0} onClick={() => setHeaderExpanded(false)} onKeyDown={event => activateWithKeyboard(event, () => setHeaderExpanded(false))}>
                    <div className="happytohelp-chat-header-desc-title">
                        {context.text.ai.selection}
                        <span className="happytohelp-chat-header-edit-inline">
                            <FontAwesomeIcon icon={faAngleUp}/>
                        </span>
                    </div>
                    <div className="happytohelp-chat-header-edit">
                        <FontAwesomeIcon icon={faAngleUp}/>
                    </div>
                </div>
                {agentRows}
            </div>
        );
    }
    else if(currentAgent) {
        content = (
            <div className={"happytohelp-chat-header"+(canExpand ? "" : " happytohelp-chat-no-action")} role={canExpand ? 'button' : undefined} tabIndex={canExpand ? 0 : undefined} aria-expanded={canExpand ? headerExpanded : undefined} aria-label={canExpand ? `${currentAgent.first_name ?? currentAgent.name}, ${context.text.ai.selection}` : undefined} onClick={() => canExpand && setHeaderExpanded(true)} onKeyDown={canExpand ? event => activateWithKeyboard(event, () => setHeaderExpanded(true)) : undefined} ref={responderToggleRef} style={ context.theme.window }>
                <AgentAvatar agent={currentAgent} canAnimate={thinking}/>
                <div className="happytohelp-insight-agent">
                    <span className="happytohelp-insight-agent-name">
                        {currentAgent.first_name ?? currentAgent.name}
                        {currentAgent.is_ai && <small className="happytohelp-ai-disclosure">AI assistant</small>}
                        {canExpand && <span className="happytohelp-chat-header-edit-inline-tiny">
                            <FontAwesomeIcon icon={faAngleDown}/>
                        </span>}
                    </span>
                    <span className="happytohelp-insight-agent-seperator">•</span>
                    <span className="happytohelp-insight-agent-role">
                        {currentAgent.role ?? (currentAgent.is_ai ? context.text.ai.ai : context.text.ai.human)}
                        {canExpand && <span className="happytohelp-chat-header-edit-inline">
                            <FontAwesomeIcon icon={faAngleDown}/>
                        </span>}
                        {!currentAgent.is_ai && <div className="happytohelp-insight-agent-info"><span className="happytohelp-insight-agent-seperator-tiny">•</span>{humanResponse}
                        </div>}
                    </span>
                </div>
                {canExpand && <div className="happytohelp-chat-header-edit">
                    <FontAwesomeIcon icon={faAngleDown}/>
                </div>}
            </div>
        );
    }

    let style = {};
    if(lastHeight) {
        style = {height: lastHeight};
    }

    return <div className={"happytohelp-chat-header-container " + (headerExpanded ? "happytohelp-chat-header-container-expanded" : "happytohelp-chat-header-container-collapsed")} style={style} onKeyDown={handleHeaderKeyDown}>
        <button type="button" className="happytohelp-close" { ...tooltip('Close chat') } onClick={() => { setOpen(false) }}>
            <FontAwesomeIcon icon={falTimes} aria-hidden="true"/>
        </button>
        <div ref={contentEl}>
            {context.brand?.logo_url && <div className="happytohelp-brand-heading"><img src={context.brand.logo_url} alt="" /><span>{context.brand.name}</span></div>}
            {content}
        </div>
    </div>;
};
