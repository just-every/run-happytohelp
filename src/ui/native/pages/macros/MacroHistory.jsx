import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../transport';
import {Section} from '../forms';
export default function MacroHistory({path,version}){
 const [versions,setVersions]=useState([]),[usage,setUsage]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([nativeRequest(`${path}/versions`),nativeRequest(`${path}/usage`)]).then(([v,u])=>{if(active){setVersions(v.data);setUsage(u.data)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[path,version]);
 return <Section title="Versions and usage">{error&&<p role="alert">{error}</p>}<div className="table-responsive"><table className="table management-table"><thead><tr><th>Version</th><th>Saved</th><th>Uses</th><th>Definition</th></tr></thead><tbody>{versions.map(v=><tr key={v.version}><td>{v.version}</td><td>{new Date(v.created_at).toLocaleString()}</td><td>{usage.filter(u=>u.version===v.version).reduce((n,u)=>n+u.uses,0)}</td><td><details><summary>{v.title}</summary><pre className="text-wrap">{v.content}</pre><dl>{Object.entries(v.actions).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{JSON.stringify(value)}</dd></React.Fragment>)}</dl></details></td></tr>)}</tbody></table></div></Section>;
}
