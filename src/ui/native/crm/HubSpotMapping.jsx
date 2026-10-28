import React, {useEffect, useState} from 'react';
import {nativeRequest} from '../transport';
import {crmJson} from './useCrmResource';

export default function HubSpotMapping({projectId, contact, data, loading, writable, run}) {
    const [companies, setCompanies] = useState(null), [companyError, setCompanyError] = useState('');
    const [source, setSource] = useState(''), [company, setCompany] = useState(''), [sourceCompany, setSourceCompany] = useState('');
    const [editing, setEditing] = useState(false), [removing, setRemoving] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/companies`, {signal: controller.signal}).then(result => {if (!controller.signal.aborted) setCompanies(result.companies);}).catch(error => {if (!controller.signal.aborted) setCompanyError(error.message);});
        return () => controller.abort();
    }, [projectId]);
    if (!writable) return <p>Your role needs integrations.install to map or refresh CRM context.</p>;
    const mapped = !!data?.source_contact_id;
    const start = () => {setSource(data?.source_contact_id || ''); setCompany(data?.company_id || ''); setSourceCompany(data?.source_company_id || ''); setEditing(true); setRemoving(false);};
    return <div className="crm-mapping">
        <h4>Explicit customer mapping</h4>
        {editing && <p>HubSpot email must match {contact.email || 'a native email you add first'}. A company needs matching membership, domain and HubSpot association. Refresh after saving to verify identity.</p>}
        {mapped && data.company_id && <p>Native company: {companies?.find(item => item.id === data.company_id)?.name || 'Company unavailable'} → HubSpot {data.source_company_id}</p>}
        {companyError && <p role="alert">Company choices unavailable: {companyError}. Reopen this customer to retry.</p>}
        {!editing ? <div className="crm-actions"><button type="button" className="btn btn-white" disabled={loading || data?.state === 'disconnected'} onClick={start}>{mapped ? 'Remap customer' : 'Map customer to HubSpot'}</button>
            {mapped && <button type="button" className="btn btn-outline-danger" disabled={loading} onClick={() => setRemoving(true)}>Remove HubSpot mapping</button>}
        </div> : <form className="crm-form" onSubmit={async event => {
            event.preventDefault();
            if (await run(crmJson('PUT', {source_contact_id: source, company_id: company || null, source_company_id: company ? sourceCompany : null}), 'Mapping saved as stale. Refresh to verify identity and read context.')) setEditing(false);
        }}>
            <label>HubSpot contact ID<input className="form-control" required inputMode="numeric" pattern="[0-9]+" maxLength={200} value={source} onChange={e => setSource(e.target.value)}/></label>
            <label>Native company (optional)<select aria-label="Native company (optional)" className="form-select" value={company} disabled={!companies} onChange={e => {setCompany(e.target.value); setSourceCompany('');}}><option value="">No company mapping</option>{companies?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {company && <label>HubSpot company ID<input className="form-control" required inputMode="numeric" pattern="[0-9]+" maxLength={200} value={sourceCompany} onChange={e => setSourceCompany(e.target.value)}/></label>}
            <div className="crm-actions"><button className="btn btn-primary" disabled={loading || !contact.email}>Save explicit mapping</button><button type="button" className="btn btn-white" disabled={loading} onClick={() => setEditing(false)}>Cancel mapping</button></div>
        </form>}
        {removing && <div><p>Remove this mapping and its cached CRM values?</p><div className="crm-actions"><button type="button" className="btn btn-danger" disabled={loading} onClick={async () => {if (await run({method: 'DELETE'}, 'Mapping removed. No CRM context is linked.')) setRemoving(false);}}>Confirm remove mapping</button><button type="button" className="btn btn-white" onClick={() => setRemoving(false)}>Cancel removal</button></div></div>}
    </div>;
}
