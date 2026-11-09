import React, { useCallback, useEffect, useRef, useState } from 'react';
import { busyWait, isBusy } from '../../../dashboard/utils/busy';
import { attributeValue, companyRequest } from './company-api';
import CompanyMembers from './CompanyMembers';
import CompanyTickets from './CompanyTickets';
import CompanyMerge from './CompanyMerge';
import CompanyHistory from './CompanyHistory';

export default function CompanyDetail({ projectId, companyId, companies, canManage, onBack, onEdit, onChanged }) {
    const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('tickets');
    const view = useRef(0), retry = useRef(null);
    const load = useCallback(async () => { const result = await companyRequest(projectId, companyId); setData(result); setBusy(false); }, [projectId, companyId]);
    // A busy database (503) is a wait: keep what is shown, say so, and run the read again after Retry-After while this company is open.
    const wait = (failure, again) => { const current = view.current; setBusy(true); clearTimeout(retry.current); retry.current = setTimeout(() => { retry.current = null; if (view.current === current) again(); }, busyWait(failure)); };
    const failed = failure => { if (isBusy(failure)) wait(failure, () => load().catch(failed)); else { setBusy(false); setError(failure.message); } };
    useEffect(() => {
        const current = ++view.current; setData(null); setError(''); setBusy(false); setTab('tickets');
        const open = () => companyRequest(projectId, companyId).then(result => { if (view.current === current) { setData(result); setBusy(false); } }).catch(failure => { if (view.current !== current) return; if (isBusy(failure)) wait(failure, open); else { setBusy(false); setError(failure.message); } });
        open();
        return () => { view.current++; clearTimeout(retry.current); retry.current = null; };
    }, [projectId, companyId]);
    const refresh = async () => {
        const current = view.current, results = await Promise.allSettled([load(), onChanged()]);
        const failure = results.find(result => result.status === 'rejected');
        if (view.current !== current) return;
        if (failure && isBusy(failure.reason)) { wait(failure.reason, refresh); return; }
        setError(failure ? `The change was saved, but the company view could not refresh: ${failure.reason.message}` : '');
    };
    return <div className="companies-detail" aria-busy={busy || undefined}><button className="companies-back" onClick={onBack}>← All companies</button>
        {error && <p className="alert alert-danger" role="alert">{error}<button className="btn btn-link" onClick={() => { setError(''); load().catch(failed); }}>Try again</button></p>}
        {busy && <p className="settings-note" role="status">The workspace is busy. Trying again in a few seconds…</p>}
        {!data && !error && !busy && <p role="status">Loading company…</p>}
        {data && <><div className="companies-detail-hero"><div className="companies-detail-identity"><span className="companies-avatar companies-avatar--large" aria-hidden="true">{data.company.name.slice(0, 1).toUpperCase()}</span><div><h2>{data.company.name}</h2><p className="settings-note">{data.members.length} {data.members.length === 1 ? 'member' : 'members'} · {data.tickets.length} {data.tickets.length === 1 ? 'ticket' : 'tickets'}</p></div></div>{canManage && <button className="btn btn-outline-secondary" onClick={onEdit}>Edit company</button>}</div>
            <div className="companies-detail-grid"><aside className="companies-summary" aria-label="Company details"><section><h3>Domains</h3><div className="companies-chips">{data.company.domains.length ? data.company.domains.map(domain => <span key={domain} className="companies-chip">{domain}</span>) : <p className="settings-note mb-0">No domains added.</p>}</div></section><section><h3>Company attributes</h3>{data.fields.length ? <dl className="companies-facts">{data.fields.map(field => <div key={field.id}><dt>{field.name}</dt><dd>{attributeValue(data.company.attributes[field.id])}</dd></div>)}</dl> : <p className="settings-note mb-0">No attributes defined.</p>}</section><section><h3>Company portal view</h3><span className={`companies-status${data.company.portalCompanyView ? ' is-enabled' : ''}`}>{data.company.portalCompanyView ? 'Enabled' : 'Off'}</span><p className="settings-note mt-2 mb-0">{data.company.portalCompanyView ? 'Verified company members can view company tickets in the portal.' : 'Members keep their individual ticket access. Company ticket sharing is off.'}</p></section></aside>
                <div className="companies-detail-main"><nav className="companies-detail-tabs" aria-label="Company sections">{[['tickets', 'Members & tickets'], ['history', 'History'], ...(canManage ? [['merge', 'Merge companies']] : [])].map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
                    {tab === 'tickets' && <><CompanyMembers projectId={projectId} company={data.company} members={data.members} canManage={canManage} onChanged={refresh}/><CompanyTickets projectId={projectId} tickets={data.tickets}/></>}
                    {tab === 'history' && <CompanyHistory projectId={projectId} company={data.company} history={data.history} fields={data.fields} contacts={data.members} canManage={canManage} onChanged={refresh}/>}
                    {tab === 'merge' && canManage && <CompanyMerge projectId={projectId} company={data.company} companies={companies} fields={data.fields} onChanged={refresh}/>}
                </div>
            </div>
        </>}
    </div>;
}
