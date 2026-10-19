import React, {useEffect,useState} from 'react';
import { attributeValue } from './company-api';

export default function ImportRows({ run, fields }) {
    const [page,setPage]=useState(1),size=25,pages=Math.max(1,Math.ceil(run.rows.length/size));
    useEffect(()=>setPage(1),[run.id]);
    const rows=run.rows.slice((page-1)*size,page*size);
    return <div className="companies-import-rows"><div className="companies-section-heading"><div><h3>Every row, accounted for</h3><p className="settings-note">{run.rows.length} source rows. Review the values, company match and reason for each action.</p></div></div>
        <div className="table-responsive"><table className="table management-table stack-table companies-import-table"><thead><tr><th>CSV row</th><th>Action</th><th>Record values</th><th>Company match</th><th>Reason</th></tr></thead><tbody>{rows.map(row => <tr key={row.row}>
            <td data-label="CSV row">{row.row}</td><td data-label="Action"><span className={`companies-status companies-status--${row.action}`}>{row.action === 'create' ? 'Create' : row.action === 'update' ? 'Update' : 'Skip'}</span></td>
            <td data-label="Record values"><dl className="companies-import-values">{Object.entries(row.data).map(([key, value]) => key === 'attributes' ? Object.entries(value).map(([id, item]) => <div key={`attribute-${id}`}><dt>{fields.find(field => field.id === id)?.name || id}</dt><dd>{attributeValue(item)}</dd></div>) : <div key={key}><dt>{{ name: 'Name', email: 'Email', externalId: 'External ID', company: 'Company', domains: 'Domains' }[key] || key}</dt><dd>{attributeValue(value)}</dd></div>)}</dl></td>
            <td data-label="Company match">{row.domainMatch ? <div><strong>{row.domainMatch.companyName}</strong><small className="settings-note">{row.domainMatch.domain}</small></div> : <span className="settings-note">{run.kind === 'companies' ? '—' : 'No domain match'}</span>}</td><td data-label="Reason">{row.reason}</td>
        </tr>)}</tbody></table></div>
        <nav className="companies-actions" aria-label="CSV preview pages"><button className="btn btn-white" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Previous rows</button><span role="status">Rows {(page-1)*size+1}–{Math.min(page*size,run.rows.length)} of {run.rows.length} · Page {page} of {pages}</span><button className="btn btn-white" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>Next rows</button></nav>
    </div>;
}
