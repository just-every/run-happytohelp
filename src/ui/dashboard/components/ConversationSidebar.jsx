import FeedbackPanel from '../../../modules/feedback/ui/FeedbackPanel';
import ExecutionTrace from './conversation/ExecutionTrace';
import ProductionTrace from './conversation/ProductionTrace';
import TicketChannel from '../../../modules/support-channels/TicketChannel';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useDashboardSettings } from '../../native/dashboard-state';
import Api from '../api';
import { ChatContext } from '../contexts/ChatContext';
import usePluginMessageEvent from '../hooks/usePluginMessageEvent';
import ContactUpdateModal from './ContactUpdateModal';
import EmailConversationTranscriptModal from './EmailConversationTranscriptModal';
import MetadataItem from './MetadataItem';
import ConversationContactDetails from './conversation/ConversationContactDetails';
import ConversationDetailSection from './conversation/ConversationDetailSection';
import ConversationEnvironmentDetails from './conversation/ConversationEnvironmentDetails';
import ResolutionSummary from './conversation/ResolutionSummary';
import ConversationActions from './conversation-actions/ConversationActions';
import EscalationsPanel from './escalations/EscalationsPanel';
import HandleTimer from './tickets/HandleTimer';
import useHandleTimer, { handleDuration } from './tickets/useHandleTimer';
import ProblemPanel from './tickets/ProblemPanel';
import PossiblySameCustomer from './tickets/PossiblySameCustomer';
import TicketEditor from './tickets/TicketEditor';
import TicketHistory from './tickets/TicketHistory';
import TicketSection from './ticket-panel/TicketSection';
import TicketSummary from './ticket-panel/TicketSummary';
import useTicketRecord from './ticket-panel/useTicketRecord';
import WorkflowPanel, { useConversationWorkflows } from './workflows/WorkflowPanel';

ConversationSidebar.propTypes = {
    conversation: PropTypes.object.isRequired,
    isShown: PropTypes.bool,
    requestedSection: PropTypes.string,
    requestVersion: PropTypes.number,
    // Counts the start menu dialogs that changed the ticket; the panel's records are read again after each.
    reads: PropTypes.number,
    // Changes when the live connection brings news (a message, an activity, an escalation, a reconnect).
    liveKey: PropTypes.any,
    onAlertChange: PropTypes.func,
    onReviewEscalationDraft: PropTypes.func,
    onTicketChanged: PropTypes.func.isRequired,
};

/**
 * The Ticket tab. It opens on the Summary; every other part of the ticket's record is a collapsed section with a
 * count when it has content. In a demo project the ticket and workflow tools stay hidden, as before.
 */
export default function ConversationSidebar(props) {
    const settings = useDashboardSettings();
    const isDemo = Boolean((settings.projects?.[props.conversation.project_id] || settings.project)?.is_demo);
    return isDemo ? <TicketPanel { ...props } /> : <TicketPanelWithRecord { ...props } />;
}

function TicketPanelWithRecord(props) {
    const record = useTicketRecord(props.conversation, props.reads);
    const workflows = useConversationWorkflows(props.conversation, props.reads);
    return <TicketPanel { ...props } record={ record } workflows={ workflows } />;
}

function HandleTimeBadge() {
    const { running, total, loaded } = useHandleTimer();
    if (!loaded) return null;
    return running ? `Running · ${ handleDuration(total) }` : total >= 1000 ? handleDuration(total) : null;
}

function TicketPanel({ conversation, record = null, workflows = null, isShown, requestedSection, requestVersion, reads, liveKey, onAlertChange, onReviewEscalationDraft, onTicketChanged }) {
    const { updateConversation, plugins, pluginsRef, agentsFor, aisFor } = useContext(ChatContext);
    const [ isContactModalVisible, setIsContactModalVisible ] = useState(false);
    const [ isEmailConversationTranscriptModalVisible, setIsEmailConversationTranscriptModalVisible ] = useState(false);
    const [ open, setOpen ] = useState(() => new Set());
    const [ focusSection, setFocusSection ] = useState(null);
    const [ badges, setBadges ] = useState({});
    const [ escalationUpdates, setEscalationUpdates ] = useState(0);
    const badge = useCallback(key => value => setBadges(current => current[key] === value ? current : { ...current, [key]: value }), []);
    const [ badgeSetters ] = useState(() => ({ schedules: badge('schedules'), escalations: badge('escalations'), merges: badge('merges'), problem: badge('problem') }));
    const manage = Boolean(record?.manage);

    const toggle = useCallback(id => setOpen(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    }), []);
    const openSection = useCallback(id => {
        setOpen(current => new Set(current).add(id));
        setFocusSection(id);
    }, []);

    // "+" › Mark as problem… and a shared escalation open their section; its first action (or its heading) takes focus.
    useEffect(() => { if (requestedSection) openSection(requestedSection); }, [ requestedSection, requestVersion, openSection ]);
    // The section may still be loading (it appears with the ticket record), and a compact panel is still sliding in
    // (its visibility turns on with the slide). Problem and incidents waits briefly for its Mark button to load;
    // otherwise the section's own first action, or its heading, takes focus.
    const sectionReady = Boolean(record?.ticket) || !record;
    useEffect(() => {
        if (!focusSection || !isShown || !sectionReady) return undefined;
        let attempts = 0, timer;
        const tick = () => {
            const body = document.getElementById(`ticket-section-${ focusSection }`);
            const heading = document.getElementById(`ticket-section-${ focusSection }-heading`);
            const action = body?.querySelector('[data-section-focus]:not(:disabled)');
            const waiting = !action && focusSection === 'problem' && attempts < 20;
            const target = action || (waiting ? null : heading);
            if (target) {
                target.scrollIntoView?.({ block: 'nearest' });
                target.focus({ preventScroll: true });
                if (document.activeElement === target) { setFocusSection(null); return; }
            }
            attempts += 1;
            if (attempts > 24) { setFocusSection(null); return; }
            timer = window.setTimeout(tick, 150);
        };
        const frame = window.requestAnimationFrame(tick);
        return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
    }, [ focusSection, isShown, open, sectionReady ]);

    // The header's dot: an open SLA alert, or a customer update waiting for review.
    const slaAlert = (workflows?.sla.data?.data?.alerts || []).some(alert => alert.state === 'open');
    const alert = slaAlert || escalationUpdates > 0;
    useEffect(() => { onAlertChange?.(alert); }, [ alert, onAlertChange ]);

    const handleBlock = block => {
        if (!confirm(`Are you sure you want to ${ block ? 'block' : 'unblock' } this contact?`)) return;
        Api.update(`/projects/${ conversation.project_id }/contacts/${ conversation.contact_id }`, { is_blocked: block })
            .then(data => updateConversation(conversation.id, { contact: data.data }))
            .catch(error => console.log(error));
    };

    const handlePluginSetHeight = event => {
        pluginsRef.current.forEach(iframe => {
            if (!iframe) return;
            const pluginWindow = iframe.contentWindow || iframe.contentDocument.defaultView;
            if (pluginWindow === event.source) iframe.height = event.data.payload;
        });
    };
    usePluginMessageEvent(handlePluginSetHeight, 'setHeight');

    const ticket = record?.ticket;
    const historyCount = (ticket?.history?.length || 0) + (conversation.resolution ? 1 : 0) + (conversation.resolutionHistory?.length || 0);
    const section = (id, title, children, sectionBadge) => <TicketSection key={ id } id={ id } title={ title } badge={ sectionBadge } open={ open.has(id) } onToggle={ toggle }>{ children }</TicketSection>;

    return <div className="conversation-details">
        <TicketSummary conversation={ conversation } record={ record } workflows={ workflows } escalationUpdates={ escalationUpdates } onOpenSection={ openSection } />
        <div className="ticket-sections">
            { section('trace', 'Execution trace', <ProductionTrace conversation={ conversation } active={ Boolean(isShown) && open.has('trace') } />) }
            { record && section('fields', 'Ticket fields', <TicketEditor conversation={ conversation } record={ record } />) }
            { workflows && section('schedules', 'Schedules', <WorkflowPanel conversation={ conversation } workflows={ workflows } onBadge={ badgeSetters.schedules } />, badges.schedules) }
            { section('feedback', 'Product feedback', <FeedbackPanel projectId={ conversation.project_id } conversationId={ conversation.id } refreshKey={ liveKey } active={ open.has('feedback') } />) }
            { ['sms','whatsapp','instagram','messenger','slack','teams'].includes(conversation.channel) && section('support-channel', 'Support channel', <TicketChannel projectId={conversation.project_id} conversationId={conversation.id} refreshKey={liveKey}/>) }
            { section('escalations', 'Escalations', <EscalationsPanel projectId={ conversation.project_id } conversationId={ conversation.id } refreshKey={ liveKey } reads={ reads } onDraft={ onReviewEscalationDraft } onBadge={ badgeSetters.escalations } onUpdates={ setEscalationUpdates } />, badges.escalations) }
            { section('merges', 'Merges and partner threads', <ConversationActions conversation={ conversation } refreshKey={ liveKey } reads={ reads } onChanged={ onTicketChanged } onBadge={ badgeSetters.merges } />, badges.merges) }
            { manage && section('problem', 'Problem and incidents', <ProblemPanel projectId={ conversation.project_id } conversationId={ conversation.id } ticket={ ticket } onChanged={ () => record.reload() } onBadge={ badgeSetters.problem } />, badges.problem) }
            { manage && section('handle-time', 'Handle time', <HandleTimer />, <HandleTimeBadge />) }
            { (ticket || historyCount > 0) && section('history', 'History', <>
                { ticket && record.settings && <TicketHistory history={ ticket.history } settings={ record.settings } agents={ agentsFor(conversation.project_id) || [] } assistants={ aisFor(conversation.project_id) || [] } conversation={ { ...conversation, tags: ticket.tags || conversation.tags } } /> }
                <ResolutionSummary resolution={ conversation.resolution } history={ conversation.resolutionHistory } />
            </>, historyCount) }
            { section('production-trace', 'Production AI trace', <ExecutionTrace key={conversation.id} projectId={conversation.project_id} conversationId={conversation.id} shown={isShown&&open.has('production-trace')}/> ) }
            { section('customer', 'Customer', <>
                <ConversationContactDetails
                    conversation={ conversation }
                    onEdit={ () => setIsContactModalVisible(true) }
                    onEmailTranscript={ () => setIsEmailConversationTranscriptModalVisible(true) }
                    onToggleBlock={ handleBlock }
                />
                <PossiblySameCustomer projectId={ conversation.project_id } contact={ { ...conversation.contact, id: conversation.contact_id } } active={ open.has('customer') } />
                <ConversationEnvironmentDetails contact={ conversation.contact } />
                { conversation.contact.metadata && <ConversationDetailSection className="conversation-details-metadata" title="Metadata">
                    { Object.entries(conversation.contact.metadata).map(([ key, value ]) => <MetadataItem key={ key } name={ key } value={ value } />) }
                </ConversationDetailSection> }
            </>) }
            { plugins.map((plugin, index) => section(`plugin-${ plugin.id }`, plugin.name, <iframe
                id={ `plugin-${ plugin.id }` }
                ref={ element => { pluginsRef.current[index] = element; } }
                className="conversation-details-plugin__frame"
                src={ plugin.url }
                data-h2h-plugin-origin={ new URL(plugin.url).origin }
                title={ plugin.name }
                sandbox="allow-scripts allow-same-origin allow-forms"
                frameBorder="0"
                width="100%"
                height="500"
            ></iframe>)) }
        </div>
        { isContactModalVisible && <ContactUpdateModal contact={ conversation.contact } conversation={ conversation } onHide={ () => setIsContactModalVisible(false) } /> }
        { isEmailConversationTranscriptModalVisible && <EmailConversationTranscriptModal conversation={ conversation } onHide={ () => setIsEmailConversationTranscriptModalVisible(false) } /> }
    </div>;
}
