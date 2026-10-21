import React, { useContext, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import Bucket from "./Bucket";
import moment from "moment";
import ContactAvatar from "./ContactAvatar";
import AgentAvatar from "./AgentAvatar";
import TimeFormat from "./includes/TimeFormat";
import * as transcriptGrouping from "../utils/transcriptGrouping";

import '../styles/components/BucketGroup.scss';

const minGapMS = 43200000; // 12 hours
const maxGapMS = 31556926000; // 1 year
const { getBucketBoundaryActor } = transcriptGrouping;

const renderBuckets = (buckets, conversation) => {
    const edges = buckets.map(bucket => ({
        first: getBucketBoundaryActor(bucket, 'first'),
        last: getBucketBoundaryActor(bucket, 'last'),
    }));

    return buckets.map((bucket, index) => {
        const continuesFromPrevious = Boolean(edges[index].first && edges[index - 1]?.last?.key === edges[index].first.key);
        const continuesToNext = Boolean(edges[index].last && edges[index + 1]?.first?.key === edges[index].last.key);

        return <Bucket
            key={ bucket.id }
            conversation={ conversation }
            bucket={ bucket }
            previousActorKey={ continuesFromPrevious ? edges[index - 1].last.key : null }
            continuesToNext={ continuesToNext }
        />;
    });
};

/*
 * Recursively groups buckets into sensible groups. The further back in time, the larger the group.
 */
function BucketGroup({ conversation, groupBy = 'all', groupDate = 'none', buckets = [], alwaysExpand = false, topLevel = false }) {
    const [ isExpanded, setIsExpanded ] = useState(alwaysExpand);

    let content = [];

    if(!isExpanded && !topLevel) {

        let counts = {};
        buckets.map(bucket => {
            for (const [key, value] of Object.entries(bucket.counts)) {
                counts[key] = (counts[key] || 0) + value;
            }
        });
        /*if(buckets[0].first_message) {
            if(buckets[0].first_message.contact) {
                --counts.contact_messages;
            }
            else if(buckets[0].first_message.agent) {
                --counts.agent_messages;
            }
        }
        if(buckets[buckets.length - 1].last_message) {
            if(buckets[buckets.length - 1].last_message.contact) {
                --counts.contact_messages;
            }
            else if(buckets[buckets.length - 1].last_message.agent) {
                --counts.agent_messages;
            }
        }
        if(buckets[0].first_message) {
            content.push(<Bucket key={ buckets[0].id } conversation={ conversation } bucket={ buckets[0] } firstOnly={ true } />);
        }*/
        if(counts.contact_messages || counts.agent_messages || counts.contact_events_page_view) {
            content.push(
                <div key="bucket-group" className="bucket-group mb-4 position-relative" onClick={ () => setIsExpanded(!isExpanded) }>
                    <div className="row d-flex align-items-center">
                        { (counts.contact_messages || counts.contact_events_page_view) && conversation.contact && <div className="col-auto">
                            <ContactAvatar
                                contact={ conversation.contact }
                                className="me-2 me-lg-3 avatar-sm"
                                presentation="conversation-profile" />
                        </div> }
                        { (counts.contact_messages || counts.contact_events_page_view) && <div className="col-auto ms-n3 message-outline text-gray-700">
                            { counts.contact_messages && counts.contact_messages+" message"+(counts.contact_messages > 1 ? "s" : "") }{ counts.contact_messages && counts.contact_events_page_view && " and "}{ counts.contact_events_page_view && counts.contact_events_page_view+" page view"+(counts.contact_events_page_view > 1 ? "s" : "") } ...
                        </div> }
                        <div className="col" />
                        { counts.agent_messages && <div className="col-auto align-self-end me-n3 message-outline message-outline-right text-gray-700">
                            { counts.agent_messages } message{ (counts.agent_messages > 1 ? "s" : "") } ...
                        </div> }
                        { counts.agent_messages && conversation.agent && <div className="col-auto align-self-end">
                            <AgentAvatar
                                agent={ conversation.agent }
                                className="ms-2 ms-lg-3 avatar-sm" />
                        </div> }
                    </div>
                </div>
            );
        }
        /*if(buckets[buckets.length - 1].last_message) {
            content.push(<Bucket key={ buckets[buckets.length - 1].id } conversation={ conversation } bucket={ buckets[buckets.length - 1] } lastOnly={ true } />);
        }*/
    }
    else if(isExpanded) {
        content = renderBuckets(buckets, conversation);
    }
    else {
        let lastDate, firstDate = false;
        let grouping = [];

        for(var b = buckets.length - 1; b >= 0; --b) {
            let bucket = buckets[b];
            let bucketStart = moment(bucket.created_at);
            let bucketEnd = moment(bucket.updated_at);

            if(!firstDate) {
                firstDate = bucketEnd;
                lastDate = bucketEnd;
            }

            // Group buckets by how close the last message was in each one.
            // The further we get away from the start, the longer the gap we allow.
            let firstDiff = firstDate.diff(bucketEnd);
            let lastDiff = lastDate.diff(bucketEnd);
            if(!grouping.length || (lastDiff > (firstDiff / 7) && lastDiff > minGapMS && firstDiff < maxGapMS)) {
                grouping.unshift({
                    key: bucket.id,
                    buckets: [bucket],
                    alwaysExpand: !grouping.length,
                });
            }
            else {
                grouping[0].buckets.unshift(bucket);
            }

            lastDate = bucketStart;
        }

        grouping.map(({ key, ...bucketGroup }) => {
            content.push(<BucketGroup key={ key } conversation={ conversation } { ...bucketGroup } />);
        });
    }

    return (
        <div className={"bucket-group"+(isExpanded ? " expanded" : (topLevel ? "" : " closed"))}>
            { !topLevel && <div className="bucket-group-title mb-1 mt-3 text-gray-600"><TimeFormat date={ buckets[0].created_at } endDate={ buckets[buckets.length - 1].updated_at } /></div> }
            { content }
        </div>
    );
}

BucketGroup.propTypes = {
    conversation: PropTypes.object,
    groupBy: PropTypes.string,
    groupDate: PropTypes.string,
    buckets: PropTypes.array,
    alwaysExpand: PropTypes.bool,
};

export default BucketGroup;
