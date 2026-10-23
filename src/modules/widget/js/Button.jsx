import React, {useContext, useState, useEffect} from 'react';
import AppContext from './context/AppContext';
import {ConnectContext} from "./context/ConnectContext";
import AIAvatar from "./AIAvatar";
import AgentAvatar from "./AgentAvatar";
import WorkspaceBrandAvatar from './WorkspaceBrandAvatar';
import { launcherWorkspaceBrand } from './workspaceBrand';

import {FontAwesomeIcon} from '@fortawesome/react-fontawesome'
import {faComment as fasComment} from "@fortawesome/free-solid-svg-icons";
import {faTimes as falTimes} from "@fortawesome/free-solid-svg-icons";

export default function Button(props) {
    const context = useContext(AppContext);
    const { insight, getCurrentAgent, conversationSettings } = useContext(ConnectContext);
    const currentAgent = getCurrentAgent();
    const activeInsight = insight && !insight.closed_at && insight.content ? insight : null;
    const workspaceBrand = launcherWorkspaceBrand({
        currentAgent,
        preview: context.preview,
        contextBrand: context.workspace_brand,
        conversationSettings,
    });
    const launcherAgent = currentAgent?.is_ai || currentAgent?.id != null
        ? currentAgent
        : activeInsight?.ai && { ...activeInsight.ai, is_ai: true };
    const useAvatar = Boolean(workspaceBrand || launcherAgent) && !props.open;
    const [transitioning, setTransitioning] = useState(false);
    const [showingAvatar, setShowingAvatar] = useState(useAvatar);

    useEffect(() => {
        let timeoutId;
        if(transitioning) {
            // Ensure the transition is complete before setting the avatar
            // Sometimes it can get stuck in a transition state
            timeoutId = setTimeout(() => {
                setShowingAvatar(useAvatar);
                setTransitioning(false);
            }, 300);
        }
        // Cleanup function to clear the timeout if the component unmounts
        return () => timeoutId && clearTimeout(timeoutId);
    }, [transitioning]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let timeoutId;
        if(useAvatar && !showingAvatar) {
            if(!transitioning) {
                setTransitioning(true);
                timeoutId = setTimeout(() => {
                    setShowingAvatar(true);
                    setTransitioning(false);
                }, 120);
            }
        }
        else if(!useAvatar && showingAvatar) {
            if(!transitioning) {
                setTransitioning(true);
                timeoutId = setTimeout(() => {
                    setShowingAvatar(false);
                    setTransitioning(false);
                }, 120);
            }
        }
        // Cleanup function to clear the timeout if the component unmounts
        return () => timeoutId && clearTimeout(timeoutId);
    }, [useAvatar, showingAvatar]); // eslint-disable-line react-hooks/exhaustive-deps

    let classes = ["happytohelp-button"];
    if(showingAvatar || (transitioning && useAvatar)) {
        classes.push("happytohelp-avatar");
    } else {
        classes.push("happytohelp-icon");
    }
    if (workspaceBrand && !props.open) classes.push('happytohelp-workspace-brand-launcher');
    if(props.customize) classes.push("happytohelp-customize");
    if(props.open) classes.push("happytohelp-open");
    if(transitioning) classes.push("happytohelp-button-transitioning");

    return (
        <button type="button" className={classes.join(" ")} onMouseOver={props.onMouseOver} onClick={props.onClick}
                data-h2h-tip={props.open ? 'Close chat' : 'Open chat'} aria-label={props.open ? 'Close chat' : 'Open chat'} aria-expanded={props.open}
                style={ props.open ? context.theme.button.open : context.theme.button.closed }>
            {!props.open && (workspaceBrand
                ? <WorkspaceBrandAvatar brand={workspaceBrand} />
                : launcherAgent && (launcherAgent.is_ai
                    ? <AIAvatar ai={launcherAgent} canAnimate={!props.open && props.insightOpen} />
                    : <AgentAvatar agent={launcherAgent} />))}
            <FontAwesomeIcon icon={fasComment} flip="horizontal" className="happytohelp-show-closed" />
            <FontAwesomeIcon icon={falTimes} className="happytohelp-show-opened" />
        </button>
    );
};
