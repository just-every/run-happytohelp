import React from 'react';
import {reportCount, reportDuration} from './report-format';

export default function BacklogPanel({backlog}) {
    const peak = Math.max(1, ...backlog.buckets.map(bucket => bucket.count));
    return <section className="team-report-card" aria-labelledby="team-backlog-heading">
        <div className="team-report-card-heading"><h3 id="team-backlog-heading">Backlog age</h3><span>{reportCount(backlog.total)} unresolved</span></div>
        <p className="team-report-muted">Age from ticket creation to report generation. Oldest ticket: {reportDuration(backlog.oldest_age_ms)}.</p>
        {backlog.total ? <ul className="team-report-age-buckets">{backlog.buckets.map(bucket => <li key={bucket.id}><span>{bucket.label}</span><span className="team-report-age-track" aria-hidden="true"><span style={{width: `${bucket.count / peak * 100}%`}}/></span><strong>{reportCount(bucket.count)}</strong></li>)}</ul> : <p role="status">No unresolved tickets for this selection.</p>}
    </section>;
}
