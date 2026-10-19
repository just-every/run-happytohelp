import React from 'react';

export default function CompanyList({ companies, search, onOpen, onCreate }) {
    const query = search.toLocaleLowerCase(), rows = companies.filter(company => `${company.name} ${company.domains.join(' ')}`.toLocaleLowerCase().includes(query));
    return <>
        <div className="companies-intro"><div><p className="companies-eyebrow">Customer relationships</p><h2>A shared view of every company</h2><p className="settings-note">Connect people, domains and tickets to keep the whole relationship in view.</p></div><span className="companies-total">{companies.length} {companies.length === 1 ? 'company' : 'companies'}</span></div>
        {rows.length ? <div className="table-responsive"><table className="table table-sm table-hover management-table stack-table companies-table"><thead><tr><th>Company</th><th>Domains</th><th>Members</th><th>Company portal view</th><th><span className="visually-hidden">Open company</span></th></tr></thead><tbody>{rows.map(company => <tr key={company.id}>
            <td data-label="Company"><button className="companies-name" onClick={() => onOpen(company)}><span className="companies-avatar" aria-hidden="true">{company.name.slice(0, 1).toUpperCase()}</span><span>{company.name}</span></button></td>
            <td data-label="Domains"><div className="companies-chips">{company.domains.length ? company.domains.map(domain => <span className="companies-chip" key={domain}>{domain}</span>) : <span className="settings-note">No domains</span>}</div></td>
            <td data-label="Members">{company.memberCount}</td>
            <td data-label="Company portal view"><span className={`companies-status${company.portalCompanyView ? ' is-enabled' : ''}`}>{company.portalCompanyView ? 'Enabled' : 'Off'}</span></td>
            <td className="stack-table__actions"><button className="btn btn-link" onClick={() => onOpen(company)} aria-label={`View ${company.name}`}>View <span aria-hidden="true">↗</span></button></td>
        </tr>)}</tbody></table></div> : <div className="companies-empty"><span className="companies-empty-icon" aria-hidden="true"><i className="fe fe-briefcase"/></span><h3>{search ? 'No companies match your search' : 'Bring your company relationships together'}</h3><p>{search ? 'Try a different company name or domain.' : 'Add your first company, link its contacts and see their tickets in one place.'}</p>{!search && onCreate && <button className="btn btn-primary" onClick={onCreate}>Add your first company</button>}</div>}
    </>;
}
