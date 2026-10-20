import React from 'react';
import {Link} from '@tanstack/react-router';
import {useTeamReport} from './useTeamReport';
import {reportCount, reportDuration, reportPercent} from './report-format';
import TeamReportFilters from './TeamReportFilters';
import WorkloadPanel from './WorkloadPanel';
import ServiceLevels from './ServiceLevels';
import BacklogPanel from './BacklogPanel';
import HandleTimePanel from './HandleTimePanel';
import ReportSchedules from './ReportSchedules';
import './team-reports.css';

export default function TeamReports({projectId}) {
    const state = useTeamReport(projectId);
    const {report, loading, error, downloading} = state;
    return <section className="team-reports" aria-labelledby="team-report-heading">
        <div className="team-report-title"><div><h2 id="team-report-heading">Team report</h2><p>Workload, service commitments and recorded handle time.</p></div><div className="team-report-actions"><button type="button" className="btn btn-white" disabled={loading} onClick={state.refresh}>Refresh team report</button>{report?.permissions.export && <button type="button" className="btn btn-white" disabled={downloading || loading} onClick={state.download}>{downloading ? 'Exporting…' : 'Team summary CSV'}</button>}</div></div>
        <TeamReportFilters {...state} options={report?.options}/>
        {error && <p className="text-danger" role="alert">{error}</p>}{loading && <p role="status">Loading team report…</p>}
        {report && !loading && <>
            <p className="team-report-scope">{report.range.start} through {report.range.end} (exclusive) · <strong>{report.range.timezone}</strong> · <Link to={`/projects/${projectId}/edit`}>Workspace timezone</Link><br/>{reportCount(report.denominators.cohort)} tickets in the creation cohort · {reportCount(report.denominators.native)} native · {reportCount(report.denominators.imported)} imported included · {reportCount(report.denominators.excludedImported)} imported excluded.</p>
            <div className="team-report-metrics">
                <Metric title="Incoming tickets" value={reportCount(report.denominators.cohort)} detail="Created in this range"/>
                <Metric title="Current backlog" value={reportCount(report.backlog.total)} detail={`Oldest ${reportDuration(report.backlog.oldest_age_ms)}`}/>
                <Metric title="First response SLA" value={reportPercent(report.sla.first_response.rate)} detail={`${report.sla.first_response.met} / ${report.sla.first_response.denominator} eligible clocks`}/>
                <Metric title="Next response SLA" value={reportPercent(report.sla.next_response.rate)} detail={`${report.sla.next_response.met} / ${report.sla.next_response.denominator} eligible clocks`}/>
                <Metric title="Resolution SLA" value={reportPercent(report.sla.resolution.rate)} detail={`${report.sla.resolution.met} / ${report.sla.resolution.denominator} eligible clocks`}/>
                <Metric title="Reopen rate" value={reportPercent(report.reopens.rate)} detail={`${report.reopens.reopened} / ${report.reopens.denominator ?? report.reopens.resolved} resolved tickets · ${report.reopens.events} events`}/>
                <Metric title="Handle time" value={reportDuration(report.handleTime.total_ms)} detail={`${reportCount(report.handleTime.session_count)} recorded sessions`}/>
            </div>
            {!report.denominators.cohort && <p role="status" className="team-report-empty">No tickets with messages were created in this selection. Older unresolved tickets may still appear in the backlog.</p>}
            <div className="team-report-panels"><WorkloadPanel workload={report.workload}/><ServiceLevels sla={report.sla} timezone={report.range.timezone}/><BacklogPanel backlog={report.backlog}/><HandleTimePanel handleTime={report.handleTime}/></div>
            {report.permissions.schedule ? <ReportSchedules key={projectId} projectId={projectId} options={report.options}/> : <p className="team-report-muted">Scheduling requires report and data export access.</p>}
            <details className="team-report-rules"><summary>Team report definitions and exclusions</summary><ul>{report.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><p>Imported tickets with unknown native reopen history: {reportCount(report.reopens.imported_history_unknown)}.</p><p>Generated {new Date(report.generatedAt).toLocaleString(undefined, {timeZone: report.range.timezone})} · {report.range.timezone}</p></details>
        </>}
    </section>;
}

function Metric({title, value, detail}) {
    return <section className="team-report-metric"><h3>{title}</h3><strong>{value}</strong><p>{detail}</p></section>;
}
