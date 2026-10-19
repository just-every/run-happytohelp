import React from 'react';
import { attributeValue } from './company-api';

export default function ImportRows({ run, fields }) {
    return <div className="companies-import-rows"><div className="companies-section-heading"><div><h3>Every row, accounted for</h3><p className="settings-note">{run.rows.length} source rows. Review the values, company match and reason for each action.</p></div></div>
        <div className="table-responsive"><table className="table management-table stack-table companies-import-table"><thead><tr><th>CSV row</th><th>Action</th><th>Record values</th><th>Company match</th><th>Reason</th></tr></thead><tbody>{run.rows.map(row => <tr key={row.row}>
            <td data-label="CSV row">{row.row}</td><td data-label="Action"><span className={`companies-status companies-status--${row.action}`}>{row.action === 'create' ? 'Create' : row.action === 'update' ? 'Update' : 'Skip'}</span></td>
            <td data-label="Record values"><dl className="companies-import-values">{Object.entries(row.data).map(([key, value]) => key === 'attributes' ? Object.entries(value).map(([id, item]) => <div key={`attribute-${id}`}><dt>{fields.find(field => field.id === id)?.name || id}</dt><dd>{attributeValue(item)}</dd></div>) : <div key={key}><dt>{{ name: 'Name', email: 'Email', externalId: 'External ID', company: 'Company', domains: 'Domains' }[key] || key}</dt><dd>{attributeValue(value)}</dd></div>)}</dl></td>
            <td data-label="Company match">{row.domainMatch ? <div><strong>{row.domainMatch.companyName}</strong><small className="settings-note">{row.domainMatch.domain}</small></div> : <span className="settings-note">{run.kind === 'companies' ? '—' : 'No domain match'}</span>}</td><td data-label="Reason">{row.reason}</td>
        </tr>)}</tbody></table></div>
    </div>;
}
