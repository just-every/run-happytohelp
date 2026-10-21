import React, {useEffect,useState} from 'react';
import {nativeRequest} from '../../native/transport';

/** The workspace's companies, for a member who manages contacts (`projectId` is null otherwise). */
export function useInboxCompanies(projectId){
    const [companies,setCompanies]=useState([]),[error,setError]=useState('');
    useEffect(()=>{
        const controller=new AbortController();setCompanies([]);setError('');
        if(projectId)nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/companies`,{signal:controller.signal})
            .then(result=>setCompanies(result.companies)).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
        return ()=>controller.abort();
    },[projectId]);
    return {companies,error};
}

export default function InboxCompanyFilter({companies,error,value,onChange}){
    if(error)return <p className="inbox-filter-field" role="alert">{error}</p>;
    if(!companies.length)return null;
    return <div className="inbox-filter-field">
        <label className="form-label" htmlFor="inbox-filter-company">Company</label>
        <select id="inbox-filter-company" className="form-select" aria-label="Filter tickets by company" value={value} onChange={event=>onChange(event.target.value)}>
            <option value="">All companies</option>
            {companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
    </div>;
}
