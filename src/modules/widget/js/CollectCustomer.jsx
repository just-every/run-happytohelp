import React, {useContext, useState} from 'react';

import AppContext from './context/AppContext';

import {
    faSpinner as falSpinnerThird,
    faEnvelope as falEnvelope,
    faUserAlt as falUser,
    faTimes as falTimes
} from "@fortawesome/free-solid-svg-icons";

import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {ConnectContext} from "./context/ConnectContext";
import { tooltip } from '../../tooltip/tooltip';

export default function CollectCustomer({ needsNotifyEmail, away = false, setShowCollector, localContact, contact, sendContact }) {
    const context = useContext(AppContext);
    const { getCurrentAgent } = useContext(ConnectContext);
    const currentAgent = getCurrentAgent();

    const [name, setName] = useState(contact.name || localContact.provided_name);
    const [email, setEmail] = useState(contact.email || localContact.provided_email);
    const [errorName, setErrorName] = useState(false);
    const [errorEmail, setErrorEmail] = useState(false);
    const [shake, setShake] = useState(false);

    const handleFocus = (event) => {
        event.target.select();
    }

    const handleSubmit = (event) => {
        event.preventDefault();
        let payload = {};
        let newErrorName = false;
        let newErrorEmail = false;
        if(context.settings.collect.require_name || contact.name) {
            if(!name) { // basic not empty string validation
                newErrorName = true;
            }
            else {
                payload.provided_name = name;
            }
            setErrorName(newErrorName);
        }
        if(context.settings.collect.require_email || contact.email || needsNotifyEmail) {
            if(!/\S+@\S+\.\S+/.test(email)) { // basic email validation
                newErrorEmail = true;
            }
            else {
                payload.provided_email = email;
            }
            setErrorEmail(newErrorEmail);
        }
        setShake(newErrorName || newErrorEmail ? !shake : false);
        if(!newErrorName && !newErrorEmail) {
            setShake(false);
            sendContact(payload);
        }
        else {
            setShake(!shake);
        }
    }

    let content = [];
    if(context.settings.collect.require_name || contact.name || contact.loading_name) {
        let nameIcon = (contact.loading_name ? <FontAwesomeIcon className="happytohelp-loading" icon={falSpinnerThird} /> : (contact.name ? <FontAwesomeIcon icon={falUser} /> : null));
        content.push(
            <div key="collect-name" className={"happytohelp-send-message-row"+(nameIcon ? " happytohelp-has-icon" : "")+(errorName && contact.name ? " happytohelp-send-message-row-error"+(shake ? " happytohelp-shake" : "") : "")}>
                { nameIcon }
                <input type="text" name="name" aria-label={context.text.collect.placeholder_name} defaultValue={ contact.name || localContact.provided_name } autoComplete="name" onChange={e => setName(e.target.value)} onFocus={ handleFocus } onBlur={ handleSubmit } placeholder={ context.text.collect.placeholder_name } />
            </div>
        );
    }

    if(context.settings.collect.require_email || contact.email || contact.loading_email || needsNotifyEmail) {
        let emailIcon = (contact.loading_email ? <FontAwesomeIcon className="happytohelp-loading"
                                                                  icon={falSpinnerThird}/> : (contact.email || needsNotifyEmail ?
            <FontAwesomeIcon icon={falEnvelope}/> : null));
        content.push(
            <div key="collect-email"
                 className={"happytohelp-send-message-row" + (emailIcon ? " happytohelp-has-icon" : "") + (errorEmail && contact.email ? " happytohelp-send-message-row-error" + (shake ? " happytohelp-shake" : "") : "")}>
                {emailIcon}
                <input type="email" name="email" aria-label={context.text.collect.placeholder_email} defaultValue={contact.email || localContact.provided_email}
                       autoComplete="email" onChange={e => setEmail(e.target.value)} onFocus={handleFocus}
                       onBlur={handleSubmit} placeholder={context.text.collect.placeholder_email}/>
            </div>
        );
        if(needsNotifyEmail) {
            content.push(
                <div key="collect-notify-email" className="happytohelp-send-message-row happytohelp-collect-notify-email">
                    { away ? context.text.away.email_prompt : context.text.prompt.email_prompt.replace("{agent_name}", (currentAgent?.first_name ?? currentAgent?.name) || "someone") }
                </div>
            );
        }
    }

    return (
        <form className="happytohelp-collect-customer" onSubmit={handleSubmit}>
            {!needsNotifyEmail && <div className="happytohelp-collect-customer-prompt">
                { context.text.prompt.edit_contact }
            </div> }
            { !needsNotifyEmail && <button type="button" className="happytohelp-collect-customer-close" { ...tooltip('Close contact details') } onClick={() => setShowCollector(false)}><FontAwesomeIcon icon={falTimes} aria-hidden="true" /></button> }
            {content}
        </form>
    );
};
