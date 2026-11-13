const hasValue = value => value !== null && value !== undefined && value !== '';

/*
 * Produces a short-lived, in-memory version for ordering and actor grouping.
 * Child elements are rebuilt from retained source records, so mutable display
 * fields stay current without expanding this grouping-only snapshot.
 */
const transcriptVersions = new WeakMap();
const transcriptItemVersions = new WeakMap();
let nextTranscriptVersion = 0;

const payloadVersion = payload => {
    if (!payload || typeof payload !== 'object') return payload;
    return JSON.stringify(payload);
};

const getTranscriptItemVersion = item => {
    if (!item || typeof item !== 'object') return item;

    const previous = transcriptItemVersions.get(item);
    const nextPayloadVersion = payloadVersion(item.payload);
    const nextLocalAgentVersion = payloadVersion(item.local_agent);
    if (previous
        && previous.createdAt === item.created_at
        && previous.type === item.type
        && previous.contactId === item.contact_id
        && previous.agentId === item.agent_id
        && previous.contact === item.contact
        && previous.agent === item.agent
        && previous.localAgentVersion === nextLocalAgentVersion
        && previous.payloadVersion === nextPayloadVersion
        && previous.count === item.count
        && previous.close === item.close) {
        return previous.version;
    }

    const version = `item-${++nextTranscriptVersion}`;
    transcriptItemVersions.set(item, {
        agent: item.agent,
        agentId: item.agent_id,
        localAgentVersion: nextLocalAgentVersion,
        close: item.close,
        contact: item.contact,
        contactId: item.contact_id,
        count: item.count,
        createdAt: item.created_at,
        payloadVersion: nextPayloadVersion,
        type: item.type,
        version,
    });
    return version;
};

const sameVersionedItems = (items, versions) => {
    if (items.length !== versions.length) return false;
    for (let index = 0; index < items.length; index += 1) {
        if (getTranscriptItemVersion(items[index]) !== versions[index]) return false;
    }
    return true;
};

const itemVersions = items => items.map(getTranscriptItemVersion);

const getBucketTranscriptVersion = bucket => {
    if (!bucket || typeof bucket !== 'object') return 'none';

    const previous = transcriptVersions.get(bucket);

    if (previous
        && sameVersionedItems(bucket.messages || [], previous.snapshot.messages)
        && sameVersionedItems(bucket.events || [], previous.snapshot.events)
        && getTranscriptItemVersion(bucket.first_message) === previous.snapshot.firstMessage
        && getTranscriptItemVersion(bucket.last_message) === previous.snapshot.lastMessage) {
        return previous.version;
    }

    const version = `bucket-${++nextTranscriptVersion}`;
    transcriptVersions.set(bucket, {
        snapshot: {
            events: itemVersions(bucket.events || []),
            firstMessage: getTranscriptItemVersion(bucket.first_message),
            lastMessage: getTranscriptItemVersion(bucket.last_message),
            messages: itemVersions(bucket.messages || []),
        },
        version,
    });
    return version;
};

const itemActor = item => {
    if (!item || Array.isArray(item)) {
        return null;
    }

    const contactId = hasValue(item.contact_id)
        ? item.contact_id
        : item.contact?.id;
    if (hasValue(contactId)) {
        return {
            key: `contact:${contactId}`,
            kind: 'contact',
            id: contactId,
            entity: item.contact || null,
            position: 'left',
        };
    }

    if (item.local_agent?.type === 'local_agent' && hasValue(item.local_agent.id)) {
        return {
            key: `local_agent:${item.local_agent.id}`,
            kind: 'local_agent',
            id: item.local_agent.id,
            entity: item.local_agent,
            position: 'right',
        };
    }

    const agentId = hasValue(item.agent_id)
        ? item.agent_id
        : item.agent?.id;
    if (hasValue(agentId)) {
        return {
            key: item.source_author ? `historical-agent:${JSON.stringify([item.project_id, item.source_author])}` : `agent:${agentId}`,
            kind: 'agent',
            id: agentId,
            entity: item.agent || null,
            position: 'right',
        };
    }

    return null;
};

const transcriptUnitActor = unit => {
    if (!Array.isArray(unit)) {
        return itemActor(unit);
    }

    const [ firstItem ] = unit;
    const actor = itemActor(firstItem);
    if (!actor || !unit.every(item => itemActor(item)?.key === actor.key)) {
        return null;
    }

    return unit.reduce((resolvedActor, item) => resolvedActor.entity ? resolvedActor : itemActor(item), actor);
};

const mergeActorMetadata = (existingActor, nextActor) => (
    existingActor.entity || !nextActor.entity
        ? existingActor
        : { ...existingActor, entity: nextActor.entity }
);

const sameActor = (left, right) => {
    const leftActor = itemActor(left);
    const rightActor = itemActor(right);

    return Boolean(leftActor && rightActor && leftActor.key === rightActor.key);
};

const getBucketTranscriptItems = (bucket, generatedAt = new Date().toISOString()) => {
    if (!bucket || !Array.isArray(bucket.messages) || !Array.isArray(bucket.events)) {
        return null;
    }

    const orderedItems = [ ...bucket.messages, ...bucket.events ]
        .map(item => item.created_at
            ? item
            : { ...item, created_at: generatedAt })
        .sort((left, right) => left.created_at.localeCompare(right.created_at));

    const reducedItems = [];
    orderedItems.forEach((item, index) => {
        if (!item.type) {
            reducedItems.push(item);
            return;
        }

        const countedItem = { ...item, count: item.count || 1 };
        const nextItem = orderedItems[index + 1];
        if (item.type !== 'INTERNAL_NOTE' && item.type !== 'PAGE_VIEW' && nextItem?.type === item.type && sameActor(item, nextItem) && JSON.stringify(nextItem.payload) === JSON.stringify(item.payload)) {
            orderedItems[index + 1] = { ...nextItem, count: (item.count || 1) + (nextItem.count || 1) };
            return;
        }

        reducedItems.push(countedItem);
    });

    const groupedItems = [];
    let pageViews = [];
    reducedItems.forEach((item, index) => {
        if (item.type === 'PAGE_VIEW' && reducedItems[index + 1]?.type === item.type && sameActor(item, reducedItems[index + 1])) {
            pageViews.push(item);
            return;
        }

        if (pageViews.length) {
            pageViews.push(item);
            groupedItems.push(pageViews);
            pageViews = [];
            return;
        }

        groupedItems.push(item);
    });

    return groupedItems;
};

const groupTranscriptItems = items => {
    const groups = [];

    items.forEach(item => {
        const actor = transcriptUnitActor(item);
        const previousGroup = groups[groups.length - 1];

        if (actor && previousGroup?.actor?.key === actor.key) {
            previousGroup.actor = mergeActorMetadata(previousGroup.actor, actor);
            previousGroup.items.push(item);
            return;
        }

        groups.push({ actor, items: [ item ] });
    });

    return groups;
};

const getBucketBoundaryActor = (bucket, edge) => {
    const items = getBucketTranscriptItems(bucket);
    if (!items?.length) {
        return null;
    }

    return transcriptUnitActor(edge === 'last' ? items[items.length - 1] : items[0]);
};

export {
    getBucketTranscriptVersion,
    getBucketBoundaryActor,
    getBucketTranscriptItems,
    groupTranscriptItems,
    itemActor,
    transcriptUnitActor,
};
