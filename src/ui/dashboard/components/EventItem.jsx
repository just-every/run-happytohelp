import React from 'react';
import PropTypes from 'prop-types';

import '../styles/components/MessageItem.scss';
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import externalLinks from "remark-external-links";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import Moment from '../../native/Moment';
import moment from "moment/moment";
import LocalAgentBadge from './LocalAgentBadge';
import Media from './Media';
import TranscriptEventContent from './TranscriptEventContent';

function EventItem({ conversation, item, showActor = false, actorName = null, inEventGroup = false }) {
    const eventType = typeof item.type === 'string' ? item.type : null;
    const supportedEventTypes = ['AGENT_ASSIGNED', 'USED_INSIGHT', 'PAGE_VIEW', 'INTERNAL_NOTE', 'AI_REPLY_SKIPPED'];
    if (!eventType || !supportedEventTypes.includes(eventType)) {
        return null;
    }

    let content;
    let classes = ['message-row', 'transcript-event', `transcript-event-${eventType.toLowerCase()}`];
    if (inEventGroup && eventType === 'PAGE_VIEW') {
        classes.push('transcript-event-page-view-row');
    }
    const eventPayload = item.payload || {};

    switch (eventType) {
        case 'AGENT_ASSIGNED':
            classes.push('small text-gray-600');
            content = eventPayload.type === 'unassigned' ? <span>Returned to the unassigned inbox</span> : <span>{eventPayload.type === 'ai_handoff' ? `AI handed over to ${eventPayload.name || 'a teammate'}` : eventPayload.type === 'replied' ? `${item.agent?.name || actorName || eventPayload.name || 'A teammate'} replied` : `Assigned to ${eventPayload.name || (eventPayload.is_ai ? 'AI' : 'a teammate')}${item.agent?.name || actorName ? ` by ${item.agent?.name || actorName}` : ''}`}{item.count > 1 && ` (${item.count} times)`}</span>;
            break;
        case 'USED_INSIGHT':
            classes.push('small text-gray-600');
            content = <a href={ `/projects/${conversation.project_id}/insights/${eventPayload.insight_id}` } className="text-gray-800">{item.close ? 'Closed' : 'Opened'} Insight{ item.count > 1 && ` (${item.count} times)` }</a>;
            break;
        case 'PAGE_VIEW':
            classes.push('message-row-close small text-gray-600');
            content = <span>{ !inEventGroup && 'Visited ' }<a href={ item.payload } target="_blank" rel="noopener noreferrer" className="text-gray-800 pageview">{ item.payload }</a>{ item.count > 1 && ` (${item.count} times)` }</span>;
            break;
        case 'INTERNAL_NOTE':
            classes.push('transcript-event-note');
            break;
        case 'AI_REPLY_SKIPPED':
            // Operator-only: a daily AI ceiling skipped the automatic reply; the visitor message awaits a human.
            classes.push('small text-gray-700');
            content = <span role="status"><i className="fe fe-alert-triangle" aria-hidden="true" /> <strong>Automatic AI reply skipped{ item.count > 1 && ` (${item.count} times)` }.</strong> { eventPayload.reason }</span>;
            break;
    }

    const timestampFormat = (new Date().getFullYear().toString()) === moment(item.created_at).format('YYYY')
        ? 'D MMM (LT)'
        : 'D MMM, YYYY (LT)';
    const renderTooltip = (props) => (
            <Tooltip id={`${item.id}-read-at`} {...props}>
            {item.created_at && <p className="m-0"><Moment format={ timestampFormat } date={ item.created_at } className="text-nowrap" /></p> }
        </Tooltip>
    );

    return (
        <div className={classes.join(' ')}>
            {eventType === 'INTERNAL_NOTE' ? (
                <div className="transcript-note-card">
                    <div className="transcript-note-main">
                        <div className="transcript-note-header">
                            <div className="transcript-note-byline">
                                { showActor && actorName && <span className="transcript-note-author">{ actorName }</span> }
                                { showActor && <LocalAgentBadge agent={ item.local_agent } /> }
                                <span className="transcript-note-label"><i className="fe fe-lock" aria-hidden="true" /> Internal note</span>
                                <OverlayTrigger
                                    placement="top"
                                    trigger={[ 'hover', 'focus' ]}
                                    overlay={ renderTooltip }>
                                    <time className="transcript-message-time" dateTime={ item.created_at } tabIndex={ 0 }>
                                        <Moment format="LT" date={ item.created_at } />
                                    </time>
                                </OverlayTrigger>
                            </div>
                        </div>
                        <div className="message-content message-note transcript-note-content has-content">
                            <ReactMarkdown remarkPlugins={[gfm, externalLinks]} className="mb-1">{item.payload}</ReactMarkdown>
                            { item.media?.map(media => <Media key={ media.id } media={ media } />) }
                        </div>
                    </div>
                </div>
            ) : (
                <TranscriptEventContent
                    actorName={ actorName }
                    showActor={ showActor }
                    time={ <OverlayTrigger
                        placement="top"
                        trigger={[ 'hover', 'focus' ]}
                        overlay={ renderTooltip }>
                        <time className="transcript-event-time transcript-message-time" dateTime={ item.created_at } tabIndex={ 0 } aria-label="View event details">
                            <Moment format="LT" date={ item.created_at } />
                        </time>
                    </OverlayTrigger> }>
                    { content }
                </TranscriptEventContent>
            )}
        </div>
    );

}

EventItem.propTypes = {
    conversation: PropTypes.object,
    item: PropTypes.object,
    showActor: PropTypes.bool,
    actorName: PropTypes.string,
    inEventGroup: PropTypes.bool,
};

export default EventItem;
