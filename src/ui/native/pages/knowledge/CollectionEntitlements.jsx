import React, {useEffect, useState} from 'react';
import {nativeRequest} from '../../transport';

export default function CollectionEntitlements({projectId,draft,change}) {
    const [accounts,setAccounts]=useState([]),[candidates,setCandidates]=useState([]),[query,setQuery]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
    const path=`/api/knowledge/${projectId}/categories/${draft.id}/entitlements`;
    useEffect(()=>{
        let active=true;setLoading(true);setError('');
        nativeRequest(path).then(data=>{if(active)setAccounts(data.accounts)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
        return ()=>{active=false};
    },[path]);
    useEffect(()=>{
        let active=true;setCandidates([]);
        if(!query.trim())return;
        const timer=setTimeout(()=>nativeRequest(`${path}?${new URLSearchParams({q:query})}`).then(data=>{if(active)setCandidates(data.candidates)}).catch(e=>{if(active)setError(e.message)}),200);
        return ()=>{active=false;clearTimeout(timer)};
    },[path,query]);
    const update=next=>{setAccounts(next);change('entitlementContactIds',next.map(account=>account.id))};
    const required=!!draft.requires_entitlement;
    return <section className="knowledge-entitlements" aria-label="Named customer accounts">
        <h3>Named customer accounts</h3>
        <label className="knowledge-entitlement-toggle"><input type="checkbox" checked={required} onChange={event=>{change('requires_entitlement',event.target.checked);change('entitlementContactIds',event.target.checked?accounts.map(account=>account.id):[])}}/> Require named customer accounts</label>
        {error&&<p className="alert alert-danger" role="alert">{error}</p>}
        {required&&<>
            <p className="settings-note">Only the verified accounts listed here can read this collection, subject to its sign-in rules. Accounts never gain access just by sharing an email domain. Save to apply changes.</p>
            {loading?<p role="status">Loading customer accounts…</p>:<>
                {accounts.length?<ul className="knowledge-entitlement-list">{accounts.map(account=><li key={account.id}><span><strong>{account.name||account.email}</strong><small>{account.email}</small></span><button type="button" className="btn btn-white" aria-label={`Remove ${account.name||account.email}`} onClick={()=>update(accounts.filter(item=>item.id!==account.id))}>Remove</button></li>)}</ul>:<p>No accounts have access.</p>}
                <label className="form-label" htmlFor="collection-customer-search">Find customer accounts</label>
                <input id="collection-customer-search" type="search" className="form-control" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search by name or email"/>
                {query.trim()&&<ul className="knowledge-entitlement-list">{candidates.filter(account=>!accounts.some(item=>item.id===account.id)).map(account=><li key={account.id}><span><strong>{account.name||account.email}</strong><small>{account.email}</small></span><button type="button" className="btn btn-white" aria-label={`Add ${account.name||account.email}`} onClick={()=>{update([...accounts,account]);setQuery('')}}>Add</button></li>)}</ul>}
            </>}
        </>}
    </section>;
}
