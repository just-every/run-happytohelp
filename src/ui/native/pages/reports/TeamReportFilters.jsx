import React from 'react';

export default function TeamReportFilters({draft, change, apply, loading, options}) {
    return <form className="team-report-filters" aria-label="Team report filters" onSubmit={apply}>
        <label>Team report range<select aria-label="Team report range" className="form-select" value={draft.period} onChange={event => change('period', event.target.value)}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom dates</option>
        </select></label>
        {draft.period === 'custom' && <>
            <label>Team report start (inclusive)<input className="form-control" type="date" required value={draft.start} onChange={event => change('start', event.target.value)}/></label>
            <label>Team report end (exclusive)<input className="form-control" type="date" required value={draft.end} min={draft.start} onChange={event => change('end', event.target.value)}/></label>
        </>}
        <label>Team filter<select aria-label="Team filter" className="form-select" value={draft.teamId} onChange={event => change('teamId', event.target.value)} disabled={loading}>
            <option value="">All teams</option>{options?.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select></label>
        <label>Brand filter<select aria-label="Brand filter" className="form-select" value={draft.brandId} onChange={event => change('brandId', event.target.value)} disabled={loading}>
            <option value="">All brands</option>{options?.brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select></label>
        <label className="team-report-check"><input type="checkbox" checked={draft.includeImported} onChange={event => change('includeImported', event.target.checked)}/> Include imported history</label>
        <button type="submit" className="btn btn-primary" disabled={loading}>Apply team filters</button>
    </form>;
}
