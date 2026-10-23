import React, {useState} from 'react';
import {reportCount} from './report-format';

const groupings = [['agent', 'Agent'], ['team', 'Team'], ['channel', 'Channel'], ['brand', 'Brand'], ['account', 'Account'], ['tag', 'Tag']];

export default function WorkloadPanel({workload}) {
    const [group, setGroup] = useState('team');
    const rows = workload[group];
    return <section className="team-report-card" aria-labelledby="team-workload-heading">
        <div className="team-report-card-heading"><h3 id="team-workload-heading">Workload</h3><label>Group workload by<select aria-label="Group workload by" className="form-select" value={group} onChange={event => setGroup(event.target.value)}>{groupings.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
        <p className="team-report-muted">Incoming tickets belong to the selected creation range. Backlog counts currently unresolved tickets created before the range ends.</p>
        {rows.length ? <div className="team-report-table-wrap" tabIndex={0} role="region" aria-label="Scrollable report table"><table className="team-report-table"><caption className="visually-hidden">Workload grouped by {group}</caption><thead><tr><th scope="col">{groupings.find(([id]) => id === group)[1]}</th><th scope="col">Incoming</th><th scope="col">Backlog</th><th scope="col">Resolved</th></tr></thead><tbody>{rows.map(row => <tr key={row.id ?? 'unassigned'}><th scope="row"><span className="team-report-dot" aria-hidden="true"/>{row.label}</th><td>{reportCount(row.incoming)}</td><td>{reportCount(row.backlog)}</td><td>{reportCount(row.resolved)}</td></tr>)}</tbody></table></div> : <p role="status">No workload for this selection.</p>}
        {group === 'tag' && <p className="team-report-muted">A ticket with multiple tags appears in each tag group. Tag rows are not additive.</p>}
    </section>;
}
