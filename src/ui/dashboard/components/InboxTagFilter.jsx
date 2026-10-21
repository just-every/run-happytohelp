import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../../native/transport';

/** The workspace's tags; a workspace inbox only (the Global Inbox has no tag filter). */
export function useInboxTags(projectId) {
    const [ tags, setTags ] = useState([]);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();

        setTags([]);

        if (projectId) {
            nativeRequest(`/api/dashboard/projects/${ projectId }/tags`, {signal: controller.signal})
                .then(result => { if (active) setTags(result.data); })
                .catch(() => { if (active) setTags([]); });
        }

        return () => { active = false; controller.abort(); };
    }, [ projectId ]);

    return tags;
}

/** The tag filter exists only once the workspace has a tag to filter by. */
export default function InboxTagFilter({ tags, value, onChange }) {
    if (tags.length === 0) return null;

    return <div className="inbox-filter-field">
        <label className="form-label" htmlFor="inbox-filter-tag">Tags</label>
        <select id="inbox-filter-tag" className="form-select" aria-label="Filter conversations by tag" value={ value } onChange={ event => onChange(event.target.value) }>
            <option value="">All tags</option>
            { tags.map(tag => <option key={ tag.id } value={ tag.id }>{ tag.name }</option>) }
        </select>
    </div>;
}
