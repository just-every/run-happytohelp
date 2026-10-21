import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ConversationSuggestions from './ConversationSuggestions';
import ConversationSidebar from './ConversationSidebar';
import DelegationPanel from './DelegationPanel';
import useScrollEdge from '../hooks/useScrollEdge';

import './conversation/ai-controls.css';

// The tab and panel ids keep their first names (ai, local, details); the words say what each is for.
const tabs = [
    { id: 'ai', label: 'Suggest', icon: 'fe-star', panelId: 'conversation-ai-panel' },
    { id: 'local', label: 'Delegate', icon: 'fe-monitor', panelId: 'conversation-local-panel' },
    { id: 'details', label: 'Ticket', icon: 'fe-list', panelId: 'conversation-details-panel' },
];

ConversationAssistant.propTypes = {
    closeButtonRef: PropTypes.object,
    conversation: PropTypes.object.isRequired,
    conversationId: PropTypes.string,
    draftError: PropTypes.string,
    isDraftDisabled: PropTypes.bool,
    isVisible: PropTypes.bool,
    liveKey: PropTypes.any,
    onAlertChange: PropTypes.func,
    onClose: PropTypes.func,
    onInsertDraft: PropTypes.func.isRequired,
    onConversationChanged: PropTypes.func.isRequired,
    onReviewEscalationDraft: PropTypes.func,
    onTicketChanged: PropTypes.func.isRequired,
    panelReads: PropTypes.number,
    panelRef: PropTypes.object,
    requestedSection: PropTypes.string,
    requestedTab: PropTypes.string,
    requestedTabVersion: PropTypes.number,
};

export default function ConversationAssistant({
    closeButtonRef,
    conversation,
    conversationId,
    draftError,
    isDraftDisabled,
    isVisible,
    liveKey,
    onAlertChange,
    onClose,
    onInsertDraft,
    onConversationChanged,
    onReviewEscalationDraft,
    onTicketChanged,
    panelReads,
    panelRef,
    requestedSection,
    requestedTab,
    requestedTabVersion,
}) {
    const [activeTab, setActiveTab] = useState('ai');
    const tabRefs = useRef({});
    const aiScrollEdge = useScrollEdge(activeTab === 'ai');
    const localScrollEdge = useScrollEdge(activeTab === 'local');
    const detailsScrollEdge = useScrollEdge(activeTab === 'details');
    const isScrolled = activeTab === 'ai'
        ? aiScrollEdge.isScrolled
        : activeTab === 'local'
            ? localScrollEdge.isScrolled
            : detailsScrollEdge.isScrolled;

    useEffect(() => {
        if (tabs.some(tab => tab.id === requestedTab)) setActiveTab(requestedTab);
    }, [ requestedTab, requestedTabVersion ]);

    useEffect(() => {
        setActiveTab('ai');
    }, [conversationId]);

    const selectTab = tabId => setActiveTab(tabId);
    const handleTabKeyDown = event => {
        const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
        let nextIndex = null;

        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        const nextTab = tabs[nextIndex];
        selectTab(nextTab.id);
        tabRefs.current[nextTab.id]?.focus();
    };

    return (
        <aside
            id="conversation-assistant"
            ref={ panelRef }
            className={ `conversation-assistant${isVisible ? ' is-open' : ''}` }
            aria-label="Conversation panel"
            aria-hidden={ !isVisible }>
            <div className={ `conversation-assistant__header${isScrolled ? ' is-scrolled' : ''}` }>
                <div className="conversation-assistant__tabs" role="tablist" aria-label="Conversation panel sections">
                    { tabs.map(tab => <button
                        key={ tab.id }
                        id={ `conversation-tab-${tab.id}` }
                        ref={ element => { tabRefs.current[tab.id] = element; } }
                        type="button"
                        className={ `conversation-assistant__tab${activeTab === tab.id ? ' is-active' : ''}` }
                        role="tab"
                        aria-selected={ activeTab === tab.id }
                        aria-controls={ tab.panelId }
                        tabIndex={ activeTab === tab.id ? 0 : -1 }
                        onClick={ () => selectTab(tab.id) }
                        onKeyDown={ handleTabKeyDown }>
                        <i className={ `fe ${tab.icon}` } aria-hidden="true"></i>
                        { tab.label }
                    </button>) }
                </div>
                <button type="button" className="btn btn-link conversation-assistant__hide" ref={ closeButtonRef } onClick={ onClose }>
                    Hide <i className="fe fe-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
            <div className="conversation-assistant__body">
                <div
                    id="conversation-ai-panel"
                    className={ `conversation-assistant__tab-panel${activeTab === 'ai' ? ' is-active' : ''}` }
                    role="tabpanel"
                    aria-labelledby="conversation-tab-ai"
                    hidden={ activeTab !== 'ai' }>
                    <ConversationSuggestions
                        scrollRef={ aiScrollEdge.ref }
                        hasHiddenAbove={ aiScrollEdge.isScrolled }
                        hasHiddenBelow={ aiScrollEdge.hasHiddenBelow }
                    />
                </div>
                <div
                    id="conversation-details-panel"
                    className={ `conversation-assistant__tab-panel${activeTab === 'details' ? ' is-active' : ''}` }
                    role="tabpanel"
                    aria-labelledby="conversation-tab-details"
                    hidden={ activeTab !== 'details' }
                    ref={ detailsScrollEdge.ref }>
                    <ConversationSidebar
                        conversation={ conversation }
                        isShown={ Boolean(isVisible) && activeTab === 'details' }
                        requestedSection={ requestedTab === 'details' ? requestedSection : null }
                        requestVersion={ requestedTabVersion }
                        reads={ panelReads }
                        liveKey={ liveKey }
                        onAlertChange={ onAlertChange }
                        onReviewEscalationDraft={ onReviewEscalationDraft }
                        onTicketChanged={ onTicketChanged }
                    />
                </div>
                <div
                    id="conversation-local-panel"
                    className={ `conversation-assistant__tab-panel${activeTab === 'local' ? ' is-active' : ''}` }
                    role="tabpanel"
                    aria-labelledby="conversation-tab-local"
                    hidden={ activeTab !== 'local' }
                    ref={ localScrollEdge.ref }>
                    { activeTab === 'local' && <DelegationPanel
                        draftError={ draftError }
                        isDraftDisabled={ isDraftDisabled }
                        conversation={ conversation }
                        onInsertDraft={ onInsertDraft }
                        onConversationChanged={ onConversationChanged }
                    /> }
                </div>
            </div>
        </aside>
    );
}
