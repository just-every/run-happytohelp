import React, {useState} from 'react';
import {reportCount, reportDuration} from './report-format';

export default function HandleTimePanel({handleTime}) {
    const [group, setGroup] = useState('byAgent');
    const rows = handleTime[group];
    return <section className="team-report-card" aria-labelledby="team-handle-heading">
        <div className="team-report-card-heading"><h3 id="team-handle-heading">Handle time</h3><label>Group handle time by<select aria-label="Group handle time by" className="form-select" value={group} onChange={event => setGroup(event.target.value)}><option value="byAgent">Agent</option><option value="byForm">Form</option><option value="byIntent">Intent</option></select></label></div>
        <p className="team-report-muted">{reportDuration(handleTime.total_ms)} recorded across {reportCount(handleTime.session_count)} sessions.</p>
        {rows.length ? <div className="team-report-table-wrap" tabIndex={0} role="region" aria-label="Scrollable report table"><table className="team-report-table"><caption className="visually-hidden">Recorded handle time by {group.slice(2).toLowerCase()}</caption><thead><tr><th scope="col">{group.slice(2)}</th><th scope="col">Time</th><th scope="col">Sessions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id ?? 'unassigned'}><th scope="row">{row.label}</th><td>{reportDuration(row.duration_ms)}</td><td>{reportCount(row.sessions)}</td></tr>)}</tbody></table></div> : <p role="status">No handle time recorded for this selection.</p>}
    </section>;
}
