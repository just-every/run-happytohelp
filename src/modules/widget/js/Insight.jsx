import React, {useContext, useEffect, useState} from 'react';

import {ConnectContext} from "./context/ConnectContext";

import ReactMarkdown from "h2h-widget-markdown";
import gfm from "h2h-widget-gfm";
import AppContext from "./context/AppContext";
import {faTimes} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import { tooltip } from '../../tooltip/tooltip';
let lastInsight = null;

export default function Insight({insightOpen, setOpen, setInsightOpen}) {
    const context = useContext(AppContext);
    const {
        insight,
        sendInsight,
    } = useContext(ConnectContext);
    const [showGlow, setShowGlow] = useState(true);
    const [moveGlow, setMoveGlow] = useState(true);
    const [hover, setHover] = useState(false);

    useEffect(() => {
        let timeoutId;
        if(insight && insight.content !== lastInsight && !showGlow) {
            setShowGlow(true);
            lastInsight = insight.content;
        }
        else if(showGlow) {
            timeoutId = setTimeout(() => {
                setShowGlow(false);
            }, 2000);
        }
        // Cleanup function to clear the timeout if the component unmounts
        return () => timeoutId && clearTimeout(timeoutId);
    }, [insight, showGlow]);

    useEffect(() => {
        let timeoutId;
        if(showGlow && !moveGlow) {
            setMoveGlow(true);
        }
        else if(!showGlow && moveGlow) {
            timeoutId = setTimeout(() => {
                setMoveGlow(false);
            }, 1000);
        }
        // Cleanup function to clear the timeout if the component unmounts
        return () => timeoutId && clearTimeout(timeoutId);
    }, [showGlow, moveGlow]);

    function handleButtonClick(button) {
        sendInsight(insight, button);
        if(button.action === 'close') {
            setInsightOpen(false);
            setOpen(false);
        }
        else if(button.action === 'send') {
            setOpen(true);
        }
    }

    function handleActivate() {
        for (const button of insight.metadata.buttons) {
            if (button.action === 'send') {
                return handleButtonClick(button);
            }
        }
        // No button matches, but still open the chat
        setOpen(true);
    }

    function handleClose() {
        for (const button of insight.metadata.buttons) {
            if (button.action === 'close') {
                return handleButtonClick(button);
            }
        }
        // No button matches, but still close the chat
        setInsightOpen(false);
        setOpen(false);
    }

    if(!insightOpen || !insight || !insight.content) return null;

    let buttons = [];
    insight.metadata.buttons.forEach((button, index) => {
        let buttonClasses = [`happytohelp-insight-button happytohelp-insight-button-${button.action}`];
        if(button.action !== 'close' && context.settings.show_glow.on_insight) {
            buttonClasses.push("happytohelp-insight-has-glow happytohelp-insight-glow-hover");
        }
        buttons.push(<div key={index} className="happytohelp-insight-button-container">
            <div className={buttonClasses.join(" ")} onClick={() => handleButtonClick(button)} style={ context.theme.insight }>
                <ReactMarkdown>{ button.text }</ReactMarkdown>
            </div>
        </div>);
    });

    let containerClasses = ["happytohelp-insight-container"];
    let insightContentClasses = ["happytohelp-insight-content"];
    if(context.settings.show_glow.on_insight) {
        insightContentClasses.push("happytohelp-insight-has-glow");
        if(showGlow) containerClasses.push("happytohelp-insight-show-glow");
        if(moveGlow) containerClasses.push("happytohelp-insight-move-glow");
    }
    else {
        insightContentClasses.push("happytohelp-insight-no-glow");
    }
    if(hover) containerClasses.push("happytohelp-insight-container-hover");

    let eventClasses = ["happytohelp-insight-events"];
    let insightClasses = ["happytohelp-insight", `happytohelp-insight-type-${insight.ai.type}`];

    return (
        <div>
            <div className={containerClasses.join(" ")}>
                <button type="button" className="happytohelp-insight-close" style={ context.theme.insight } { ...tooltip('Close') } onClick={handleClose}>
                    <FontAwesomeIcon icon={faTimes} aria-hidden="true" />
                </button>
                <div className={eventClasses.join(" ")} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
                    <div className={insightClasses.join(" ")}>
                        <div className={insightContentClasses.join(" ")} onClick={handleActivate} style={ context.theme.insight }>
                            <ReactMarkdown remarkPlugins={[gfm]}>{insight.content}</ReactMarkdown>
                        </div>
                    </div>
                    {buttons.length > 0 && <div className={"happytohelp-insight-buttons-container"}>
                        <div className={"happytohelp-insight-buttons"}>
                            {buttons}
                        </div>
                    </div>}
                </div>
            </div>
            <div className="happytohelp-insight-footer">
                <div className="happytohelp-insight-agent" onClick={handleActivate} style={ context.theme.insight }>
                    <strong>{insight.ai.name}</strong>&nbsp; • &nbsp;{insight.ai.role}
                </div>
            </div>
        </div>
    );
}
