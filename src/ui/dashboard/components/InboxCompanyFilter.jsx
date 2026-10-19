import React, {useEffect,useState} from 'react';
import {nativeRequest} from '../../native/transport';

export default function InboxCompanyFilter({projectId,value,onChange}){
    const [companies,setCompanies]=useState([]),[error,setError]=useState('');
    useEffect(()=>{
        const controller=new AbortController();setCompanies([]);setError('');
        if(projectId)nativeRequest(`/api/management/projects/${encodeURIComponent(projectId)}/companies`,{signal:controller.signal})
            .then(result=>setCompanies(result.companies)).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
        return ()=>controller.abort();
    },[projectId]);
    if(!projectId)return null;
    if(error)return <p role="alert">{error}</p>;
    if(!companies.length)return null;
    return <select className="form-select inbox-tag-filter" aria-label="Filter tickets by company" value={value} onChange={event=>onChange(event.target.value)}>
        <option value="">All companies</option>
        {companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}
    </select>;
}
