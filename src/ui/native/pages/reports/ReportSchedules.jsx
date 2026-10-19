import React from 'react';
import {useReportSchedules} from './useReportSchedules';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ReportSchedules({projectId, options}) {
    const {data, draft, change, toggleRecipient, error, notice, loading, busy, save, pause, remove} = useReportSchedules(projectId);
    const teammate = id => data.recipients.find(person => person.id === id)?.name || 'Recipient no longer eligible';
    return <section className="team-report-card team-report-schedules" aria-labelledby="team-schedules-heading">
        <h3 id="team-schedules-heading">Scheduled CSV reports</h3>
        <p className="team-report-muted">Daily reports cover the previous complete day. Weekly reports cover the previous seven complete days. Recipient access is checked at delivery.</p>
        {error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status">{notice}</p>}{loading && <p role="status">Loading report schedules…</p>}
        {data && <>
            <p className="team-report-muted">Delivery times use {data.timezone}. Only current teammates with report and export access can receive CSVs.</p>
            {data.schedules.length ? <ul className="team-report-schedule-list">{data.schedules.map(schedule => <li key={schedule.id}>
                <div><strong>{schedule.name}</strong><p>{schedule.frequency === 'weekly' ? `Weekly · ${weekdays[schedule.weekday]}` : 'Daily'} · {String(schedule.hour).padStart(2, '0')}:00 · {schedule.paused ? 'Paused' : 'Active'}</p>
                    <p>Recipients: {schedule.recipients.map(teammate).join(', ')}</p>
                    <p>{schedule.teamId ? options.teams.find(team => team.id === schedule.teamId)?.name || schedule.teamId : 'All teams'} · {schedule.brandId ? options.brands.find(brand => brand.id === schedule.brandId)?.name || schedule.brandId : 'All brands'} · Imported history {schedule.includeImported ? 'included' : 'excluded'}</p>
                    {!schedule.paused && schedule.nextRunAt != null && <p>Next run: {new Date(schedule.nextRunAt).toLocaleString(undefined, {timeZone: data.timezone})} · {data.timezone}</p>}
                </div>
                {data.permissions.manage && <div className="team-report-actions"><button type="button" className="btn btn-white" disabled={busy} onClick={() => pause(schedule)} aria-label={`${schedule.paused ? 'Resume' : 'Pause'} schedule ${schedule.name}`}>{schedule.paused ? 'Resume' : 'Pause'}</button><button type="button" className="btn btn-white" disabled={busy} onClick={() => remove(schedule)} aria-label={`Delete schedule ${schedule.name}`}>Delete</button></div>}
            </li>)}</ul> : <p role="status">No scheduled reports yet.</p>}
            {data.permissions.manage && <details className="team-report-schedule-create"><summary>Create a report schedule</summary>
                <form onSubmit={save} className="team-report-schedule-form">
                    <label>Schedule name<input className="form-control" required maxLength={120} value={draft.name} onChange={event => change('name', event.target.value)}/></label>
                    <label>Report frequency<select aria-label="Report frequency" className="form-select" value={draft.frequency} onChange={event => change('frequency', event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
                    {draft.frequency === 'weekly' && <label>Delivery weekday<select aria-label="Delivery weekday" className="form-select" value={draft.weekday} onChange={event => change('weekday', Number(event.target.value))}>{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>}
                    <label>Delivery hour ({data.timezone})<select className="form-select" value={draft.hour} onChange={event => change('hour', Number(event.target.value))}>{Array.from({length: 24}, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
                    <label>Scheduled team<select aria-label="Scheduled team" className="form-select" value={draft.teamId} onChange={event => change('teamId', event.target.value)}><option value="">All teams</option>{options.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                    <label>Scheduled brand<select aria-label="Scheduled brand" className="form-select" value={draft.brandId} onChange={event => change('brandId', event.target.value)}><option value="">All brands</option>{options.brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
                    <label className="team-report-check"><input type="checkbox" checked={draft.includeImported} onChange={event => change('includeImported', event.target.checked)}/> Include imported history in scheduled CSV</label>
                    <fieldset className="team-report-recipients"><legend>Report recipients</legend>{data.recipients.length ? data.recipients.map(person => <label className="team-report-check" key={person.id}><input type="checkbox" checked={draft.recipients.includes(person.id)} onChange={() => toggleRecipient(person.id)}/><span>{person.name} <small>{person.email}</small></span></label>) : <p>No current teammates have report and export access.</p>}</fieldset>
                    <div><button type="submit" className="btn btn-primary" disabled={busy || !data.recipients.length}>{busy ? 'Saving…' : 'Create schedule'}</button></div>
                </form>
            </details>}
        </>}
    </section>;
}
