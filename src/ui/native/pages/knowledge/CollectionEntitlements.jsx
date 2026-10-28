import React, {useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';

function GrantList({items,action,onAction}) {
    return <ul className="knowledge-entitlement-list">{items.map(item => <li key={item.id}><span><strong>{item.name || item.email}</strong>{item.email && <small>{item.email}</small>}</span><button type="button" className="btn btn-white" aria-label={`${action} ${item.name || item.email}`} onClick={() => onAction(item)}>{action}</button></li>)}</ul>;
}

export default function CollectionEntitlements({projectId,draft,change,selected,onLoaded}) {
    const [accounts,setAccounts]=useState([]),[companies,setCompanies]=useState([]),[suggestions,setSuggestions]=useState([]);
    const [candidates,setCandidates]=useState([]),[companyCandidates,setCompanyCandidates]=useState([]),[query,setQuery]=useState('');
    const [readOnly,setReadOnly]=useState(false);
    const [loading,setLoading]=useState(true),[searching,setSearching]=useState(false),[error,setError]=useState('');
    const path=`/api/knowledge/${projectId}/categories/${draft.id}/entitlements`;
    useEffect(() => {
        const controller = new AbortController();setLoading(true);setError('');setReadOnly(false);
        nativeRequest(path,{signal:controller.signal}).then(data => {
            if (controller.signal.aborted) return;
            setAccounts(data.accounts);setCompanies(data.companies);setSuggestions(data.suggestedCompanies);
            onLoaded({accounts:data.accounts,companies:data.companies});
        }).catch(failure => {if (!controller.signal.aborted) {if (failure.status === 403) setReadOnly(true);else setError(failure.message);}}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
        return () => controller.abort();
    },[path,draft.updated_at]);
    useEffect(() => {
        const controller = new AbortController();setCandidates([]);setCompanyCandidates([]);setSearching(false);
        if (readOnly || !query.trim()) return () => controller.abort();
        setSearching(true);
        const timer = setTimeout(() => nativeRequest(`${path}?${new URLSearchParams({q:query})}`,{signal:controller.signal}).then(data => {
            if (!controller.signal.aborted) {setCandidates(data.candidates);setCompanyCandidates(data.companyCandidates);}
        }).catch(failure => {if (!controller.signal.aborted) {if (failure.status === 403) setReadOnly(true);else setError(failure.message);}}).finally(() => {if (!controller.signal.aborted) setSearching(false);}),200);
        return () => {controller.abort();clearTimeout(timer);};
    },[path,query,readOnly]);
    const update = (nextAccounts,nextCompanies) => {
        setAccounts(nextAccounts);setCompanies(nextCompanies);
        change('entitlementContactIds',nextAccounts.map(account => account.id));
        change('entitlementCompanyIds',nextCompanies.map(company => company.id));
    };
    if (!selected) return null;
    if (readOnly) return <p className="settings-note knowledge-grants-readonly">Only owners and admins can view or change customer and company grants.</p>;
    if (error) return <p className="alert alert-danger" role="alert">{error}</p>;
    const availableAccounts=candidates.filter(account => !accounts.some(current => current.id === account.id));
    const availableCompanies=companyCandidates.filter(company => !companies.some(current => current.id === company.id));
    const suggested=suggestions.filter(company => !companies.some(current => current.id === company.id));
    return <section className="knowledge-entitlements" aria-label="Customer and company grants">
        <p className="settings-note">Grant verified customer accounts or companies. Company access follows current explicit company membership. Email domains never grant access. Save to apply changes.</p>
        {loading ? <p role="status">Loading grants…</p> : <>
            <h3>Customer accounts</h3>
            {accounts.length ? <GrantList items={accounts} action="Remove" onAction={account => update(accounts.filter(current => current.id !== account.id),companies)}/> : <p>No customer accounts selected.</p>}
            <h3>Companies</h3>
            {companies.length ? <GrantList items={companies} action="Remove" onAction={company => update(accounts,companies.filter(current => current.id !== company.id))}/> : <p>No companies selected.</p>}
            {suggested.length > 0 && <><h3>Suggested companies</h3><p className="settings-note">These companies match this collection’s previous domain settings. Select a company and Save to grant access.</p><GrantList items={suggested} action="Select" onAction={company => update(accounts,[...companies,company])}/></>}
            <label className="form-label" htmlFor="collection-customer-search">Find customers or companies</label>
            <input id="collection-customer-search" type="search" className="form-control" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or email"/>
            {searching && <p role="status">Searching…</p>}
            {query.trim() && !searching && <>
                {availableAccounts.length > 0 && <><h3>Customer results</h3><GrantList items={availableAccounts} action="Add" onAction={account => update([...accounts,account],companies)}/></>}
                {availableCompanies.length > 0 && <><h3>Company results</h3><GrantList items={availableCompanies} action="Add" onAction={company => update(accounts,[...companies,company])}/></>}
                {!availableAccounts.length && !availableCompanies.length && <p role="status">No additional verified customers or companies found.</p>}
            </>}
        </>}
    </section>;
}
