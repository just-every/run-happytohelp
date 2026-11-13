import React, { useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import TranscriptMessageRun from './TranscriptMessageRun';
import TimeFormat from "./includes/TimeFormat";
import EventItem from "./EventItem";
import ItemGroup from "./ItemGroup";
import { ChatContext } from "../contexts/ChatContext";
import * as transcriptGrouping from "../utils/transcriptGrouping";

import '../styles/components/Bucket.scss';
import EventGroup from "./EventGroup";
import transcriptMessageRuns from '../utils/transcriptMessageRuns';
import MessageTimestamp from './MessageTimestamp';
import LocalAgentBadge from './LocalAgentBadge';

const { getBucketTranscriptItems, getBucketTranscriptVersion, groupTranscriptItems } = transcriptGrouping;

const groupActorName = (actor, conversation) => {
    const contact = actor?.kind === 'contact' && conversation?.contact?.id != null && String(conversation.contact.id) === String(actor.id)
        ? conversation.contact
        : null;
    const entity = actor?.entity || contact;

    return actor?.kind === 'contact' ? entity?.display_name : entity?.name;
};

function Bucket({ conversation, bucket, firstOnly = false, lastOnly = false, previousActorKey = null, continuesToNext = false }) {
    const {
        fetchBucket,
    } = useContext(ChatContext);
    const [ isLoading, setIsLoading ] = useState(false);
    const transcriptVersion = getBucketTranscriptVersion(bucket);
    const items = useMemo(() => {
        if(firstOnly) {
            return bucket.first_message ? [bucket.first_message] : [];
        }
        if(lastOnly) {
            return bucket.last_message ? [bucket.last_message] : [];
        }

        return getBucketTranscriptItems(bucket);
    }, [ bucket, firstOnly, lastOnly, transcriptVersion ]);

    const actorGroups = useMemo(
        () => items ? groupTranscriptItems(items) : [],
        [ items ],
    );

    useEffect(() => {
        if (!bucket.messages && !firstOnly && !lastOnly) {
            setIsLoading(true);
            fetchBucket(conversation.id, bucket).then(() => {
                setIsLoading(false);
            });
        }
    }, [ ]);


    const classes = [
        "bucket mt-3 position-relative",
        previousActorKey && 'transcript-bucket-continues-from-previous',
    ].filter(Boolean);

    let content = [];
    if(items) {
        content = actorGroups.map((group, groupIndex) => {
            const continuesFromPrevious = groupIndex === 0 && group.actor?.key === previousActorKey;
            const actorName = groupActorName(group.actor, conversation);
            const messages = group.items.filter(item => !Array.isArray(item) && !item.type);
            const showActor = !continuesFromPrevious;
            const heading = (showActor && actorName || messages.length > 0) &&
                <div className="transcript-message-header transcript-actor-heading">
                    <div className="transcript-message-byline">
                        { showActor && actorName && <span className="transcript-message-sender">{ actorName }</span> }
                        { showActor && group.actor?.entity?.historical && <span>{ ['contact', 'ai', 'system'].includes(group.actor.entity.role) ? <>Historical { group.actor.entity.role }</> : 'Former staff' }</span> }
                        { showActor && <LocalAgentBadge agent={ messages[0]?.local_agent } /> }
                        { messages.length > 0 && <MessageTimestamp message={ messages[0] }
                            relatedMessages={ messages.slice(1) } conversation={ conversation } /> }
                    </div>
                </div>;
            const groupContent = transcriptMessageRuns(group.items).map(({ item, entries }, itemIndex) => {
                if (entries) {
                    const first = entries[0];
                    return <TranscriptMessageRun key={ `message-run-${first.id || first.local_id || itemIndex}` }
                        entries={ entries } conversation={ conversation } actorName={ actorName } showActor={ false } showHeader={ false } />;
                }
                if (Array.isArray(item)) {
                    return <EventGroup key={ `event-group-${groupIndex}-${itemIndex}` } conversation={ conversation } events={ item } showActor={ false } actorName={ actorName } />;
                }

                if (item.type) {
                    return <EventItem conversation={ conversation } key={ `event-item-${item.id || itemIndex}` } item={ item } showActor={ false } actorName={ actorName }/>;
                }

            });

            return <ItemGroup
                key={ `item-group-${groupIndex}` }
                actor={ group.actor }
                content={ groupContent }
                heading={ heading }
                continuesFromPrevious={ continuesFromPrevious }
                continuesToNext={ continuesToNext && groupIndex === actorGroups.length - 1 }
                conversation={ conversation }
            />;
        });
    }

    const lastItem = items?.length ? items[items.length - 1] : null;

    return (
        <div className={ classes.join(' ') }>
            <div className="mt-3">
                { isLoading && <div className="text-center">
                    <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div> }
                { content }
                { lastItem && !isLoading && !Array.isArray(lastItem) && !lastItem.created_at && <div className={"message message-status"+(!lastItem.contact_id ? " message-right" : "")}>
                    { lastItem.id
                        ? lastItem.created_at && <TimeFormat date={ lastItem.created_at } long={ true } className="chat-box-status" />
                        : <div className="chat-box-status">Sending...</div>
                    }
                </div> }
            </div>
        </div>
    );
}

Bucket.propTypes = {
    conversation: PropTypes.object,
    bucket: PropTypes.object,
    previousActorKey: PropTypes.string,
    continuesToNext: PropTypes.bool,
};

export default Bucket;
