import React from 'react';
import {reportCount, reportPercent} from './report-format';

const metrics = [['first_response', 'First response'], ['next_response', 'Next response'], ['resolution', 'Resolution']];

export default function ServiceLevels({sla, timezone}) {
    return <section className="team-report-card" aria-labelledby="team-sla-heading">
        <h3 id="team-sla-heading">SLA compliance</h3>
        <div className="team-report-sla-grid">{metrics.map(([key, label]) => {
            const row = sla[key];
            return <section className="team-report-sla" key={key} aria-label={`${label} SLA`}>
                <h4>{label}</h4><div className="team-report-ring" style={{'--team-sla-rate': `${(row.rate ?? 0) * 100}%`}}><strong>{reportPercent(row.rate)}</strong><span>met</span></div>
                <dl><div><dt><span className="team-report-dot" aria-hidden="true"/>Met</dt><dd>{reportCount(row.met)}</dd></div><div><dt>Breached</dt><dd>{reportCount(row.breached)}</dd></div><div><dt>Pending</dt><dd>{reportCount(row.pending)}</dd></div></dl>
                <p>{reportCount(row.met)} / {reportCount(row.denominator)} eligible clocks</p>
            </section>;
        })}</div>
        <p className="team-report-muted">Met ÷ (met + breached). Pending clocks are excluded. {reportCount(sla.tickets_with_snapshot)} tickets with an SLA snapshot; {reportCount(sla.tickets_without_snapshot)} without one.</p>
        {sla.oldest_snapshot_at != null && <p className="team-report-muted">SLA snapshots updated {new Date(sla.oldest_snapshot_at).toLocaleString(undefined, {timeZone: timezone})} through {new Date(sla.newest_snapshot_at).toLocaleString(undefined, {timeZone: timezone})} · {timezone}.</p>}
    </section>;
}
