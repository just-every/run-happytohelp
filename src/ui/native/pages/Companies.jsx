import React, { useCallback, useEffect, useState } from 'react';
import { PageHeaderActions } from '../PageHeader';
import { useNavigationGuard } from '../NavigationGuard';
import { useDashboardSettings } from '../dashboard-state';
import { companyRequest } from './companies/company-api';
import CompanyList from './companies/CompanyList';
import CompanyEditor from './companies/CompanyEditor';
import CompanyDetail from './companies/CompanyDetail';
import CompanyFields from './companies/CompanyFields';
import CustomerImport from './companies/CustomerImport';
import './management-parity.css';
import './stack-table.css';
import './companies/companies.css';
import './companies/company-detail.css';
import './companies/company-import.css';
import './companies/company-responsive.css';

export default function Companies({ projectId }) {
    const [data, setData] = useState(null), [error, setError] = useState(''), [view, setView] = useState('list');
    const [selected, setSelected] = useState(null), [search, setSearch] = useState(''), [notice, setNotice] = useState('');
    const { confirmNavigation } = useNavigationGuard();
    const settings = useDashboardSettings(), permissions = settings.projects?.[projectId]?.access?.permissions || [];
    const canManage = permissions.includes('contacts.manage'), canConfigure = permissions.includes('settings.manage'), canImport = permissions.includes('data.import');
    const load = useCallback(async () => { const result = await companyRequest(projectId); setData(result); }, [projectId]);
    useEffect(() => {
        let active = true;
        setData(null); setSelected(null); setView('list'); setError('');
        companyRequest(projectId).then(result => { if (active) setData(result); }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [projectId]);
    const go = next => { if (confirmNavigation()) { setView(next); setError(''); setNotice(''); } };
    const open = company => { setSelected(company.id); go('detail'); };
    const saved = async company => { setSelected(company.id); setView('detail'); setNotice('Company saved.'); try { await load(); } catch (failure) { setError(failure.message); } };
    return <div className="companies-workspace">
        <PageHeaderActions><div className="management-toolbar companies-header-actions">
            {view === 'list' && <div className="input-group"><input className="form-control" type="search" aria-label="Search companies" placeholder="Search companies" value={search} onChange={event => setSearch(event.target.value)}/><span className="input-group-text"><i className="fe fe-search"/></span></div>}
            {canManage && <button className="btn btn-primary" onClick={() => { if (confirmNavigation()) { setSelected(null); setView('create'); setNotice(''); } }}>Add company</button>}
        </div></PageHeaderActions>
        <nav className="companies-tabs" aria-label="Customer management">
            {[['list', 'Companies'], ...(canImport ? [['import', 'CSV imports']] : []), ...(canConfigure ? [['fields', 'Company attributes']] : [])].map(([key, label]) => <button key={key} type="button" aria-current={view === key || key === 'list' && ['detail', 'edit', 'create'].includes(view) ? 'page' : undefined} onClick={() => go(key)}>{label}</button>)}
        </nav>
        {error && <div className="alert alert-danger" role="alert">{error}<button className="btn btn-link" onClick={() => { setError(''); load().catch(failure => setError(failure.message)); }}>Try again</button></div>}
        {notice && <p role="status" className="alert alert-success">{notice}</p>}
        {!data && !error && <p role="status">Loading companies…</p>}
        {data && view === 'list' && <CompanyList companies={data.companies} search={search} onOpen={open} onCreate={canManage ? () => go('create') : null}/>}
        {data && canManage && ['create', 'edit'].includes(view) && <CompanyEditor key={view === 'create' ? 'new' : selected} projectId={projectId} companyId={view === 'edit' ? selected : null} fields={data.fields} onSaved={saved} onCancel={() => go(view === 'edit' ? 'detail' : 'list')}/>}
        {data && view === 'detail' && <CompanyDetail projectId={projectId} companyId={selected} companies={data.companies} canManage={canManage} onBack={() => go('list')} onEdit={() => go('edit')} onChanged={load}/>}
        {data && view === 'fields' && canConfigure && <CompanyFields projectId={projectId} fields={data.fields} onChanged={load}/>}
        {data && view === 'import' && canImport && <CustomerImport projectId={projectId} fields={data.fields} onChanged={load}/>}
    </div>;
}
