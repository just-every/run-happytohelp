import { Link } from '@tanstack/react-router';
import React, {useState} from 'react';
import {PageHeaderActions} from '../PageHeader';
import InvitationActions from './InvitationActions';
import RowMenu from './RowMenu';
import './stack-table.css';
import { Notepad } from '../drawings';
import PluginHelp from './PluginHelp';
import {useDashboardSettings} from '../dashboard-state';
export function PersonAvatar({person}) {return person.avatar_url?<img className="management-avatar" src={person.avatar_url} alt=""/>:<span className="management-avatar">{(person.name||person.email||'?').slice(0,1).toUpperCase()}</span>}
const date=value=>value?new Date(value).toLocaleDateString():'';
const labels={macros:'Save a Reply',agents:'Invite Agent',plugins:'Add Custom Plugin'};
const hidden=text=><span className="visually-hidden">{text}</span>;
const contactMetadata=item=>typeof item.metadata_json==='string'?JSON.parse(item.metadata_json):{};
// One definition per column. `label` is the header and, on narrow screens where rows stack as cards, the caption of each value.
// A column without a label holds row actions.
const columns={
 macros:[
  {label:'Title',cell:({item,href})=><Link to={href}>{item.title}</Link>},
  {label:'Created By',cell:({item})=>item.created_by_name},
  {label:'Created',cell:({item})=>date(item.created_at)},
 ],
 agents:[
  {label:'Agent',cell:({item,href})=><div className="management-person">{item.pending?<i className="fe fe-mail"/>:<PersonAvatar person={item}/>} {item.pending?'Pending invite':<Link to={href}>{item.name||item.email}</Link>}</div>},
  {label:'Email',cell:({item})=>item.email},
  {label:'Role',cell:({item})=><span className="management-role">{item.access_name||(item.role==='operator'?'Agent':item.role?.replace(/^./,c=>c.toUpperCase()))}</span>},
  {actions:'Actions',cell:({item,href,invitationProps})=>item.pending?<InvitationActions {...invitationProps} invitation={item}/>:<Link aria-label={`Edit ${item.name||item.email}`} to={href}>⋮</Link>},
 ],
 contacts:[
  {actions:'Photo',cell:({item,href})=><Link to={href}><PersonAvatar person={item}/></Link>},
  {label:'Name',cell:({item,href,metadata})=><Link to={href}>{metadata.provided_name||item.name||item.nickname||'Visitor'}</Link>},
  {label:'Email',cell:({item,metadata})=>metadata.provided_email||item.email},
  {label:'Country',cell:({item,metadata})=>metadata.country_name||metadata.country_code||item.country_code},
  {label:'Last Seen',cell:({item,metadata})=>metadata.is_online?'Online':date(item.last_seen_at||metadata.last_seen_at)},
  {actions:'Actions',cell:({href})=><Link aria-label="View contact" to={href}>⋮</Link>},
 ],
 plugins:[
  {label:'Name',cell:({item,href})=><Link to={href}>{item.name}</Link>},
  {actions:'Actions',cell:({item,href,index,rows,onMove})=><RowMenu className="management-menu" label={item.name}><Link to={href}>Edit</Link>{index>0&&<button type="button" onClick={()=>onMove(item.id,'move-up')}>Move Up</button>}{index<rows.length-1&&<button type="button" onClick={()=>onMove(item.id,'move-down')}>Move Down</button>}</RowMenu>},
 ],
};
export default function ManagementLists({section,items,base,onMove,projectId,emailConfigured,onChanged,onNotice,onError,query,onQuery,pagination}) {
 const [search,setSearch]=useState('');
 const settings=useDashboardSettings(),canManageContacts=settings.projects?.[projectId]?.access?.permissions?.includes('contacts.manage');
 const rows=query?(items||[]):(items||[]).filter(item=>[item.name,item.title,item.email].some(value=>String(value||'').toLowerCase().includes(search.toLowerCase())));
 const sorts=section==='contacts'?[['last_seen_at','Last seen'],['name','Name'],['email','Email'],['country','Country']]:[['title','Title'],['created_by_name','Created by'],['created_at','Created']];
 const shown=columns[section];
 return <><PageHeaderActions><div className="management-toolbar">{section!=='plugins'&&<div className="input-group"><input aria-label="Search" placeholder="Search" className="form-control" value={query?query.search:search} onChange={e=>query?onQuery({...query,search:e.target.value,page:1}):setSearch(e.target.value)}/><span className="input-group-text"><i className="fe fe-search"/></span></div>}{section==='contacts'&&canManageContacts&&<Link className="btn btn-white" to={`/projects/${projectId}/companies`}>Companies</Link>}{labels[section]&&<Link className="btn btn-primary" to={`${base}/create`}>{labels[section]}</Link>}</div></PageHeaderActions>
 {query&&<div className="d-flex flex-wrap gap-2 align-items-center mb-3"><label htmlFor="management-sort">Sort by</label><select id="management-sort" className="form-select w-auto" value={query.sort} onChange={e=>onQuery({...query,sort:e.target.value,page:1})}>{sorts.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><label className="visually-hidden" htmlFor="management-direction">Sort direction</label><select id="management-direction" className="form-select w-auto" value={query.direction} onChange={e=>onQuery({...query,direction:e.target.value,page:1})}><option value="asc">Ascending</option><option value="desc">Descending</option></select></div>}
 {section==='plugins'&&<PluginHelp/>}
 {!items&&<p role="status">Loading…</p>}
 {(section!=='plugins'||rows.length>0)&&<div className="table-responsive"><table className="table table-sm table-hover management-table stack-table"><thead><tr>{shown.map((column,index)=><th key={index}>{column.label||hidden(column.actions)}</th>)}</tr></thead><tbody>{rows.map((item,index)=>{
  const context={item,index,rows,onMove,href:`${base}/${item.id}`,metadata:section==='contacts'?contactMetadata(item):{},invitationProps:{projectId,emailConfigured,onChanged,onNotice,onError}};
  return <tr key={item.id||item.email}>{shown.map((column,position)=><td key={position} data-label={column.label} className={column.label?undefined:'stack-table__actions'}>{column.cell(context)}</td>)}</tr>;
 })}{items&&rows.length===0&&<tr><td colSpan={shown.length}>{query?.search?<p>No matches.</p>:section==='macros'?<div className="management-empty"><Notepad/><div><strong>No saved replies yet</strong><p>Save a reply to reuse it in your conversations.</p></div></div>:<p>No records yet.</p>}</td></tr>}</tbody></table></div>}
 {query&&pagination&&<nav aria-label={section==='contacts'?'Contact pages':'Saved reply pages'} className="d-flex flex-wrap gap-2 align-items-center mt-3"><button type="button" className="btn btn-white" disabled={!items||pagination.page<=1} onClick={()=>onQuery({...query,page:query.page-1})}>Previous</button><span role="status">Page {pagination.page} · {pagination.total} {section==='contacts'?'contacts':'saved replies'}</span><button type="button" className="btn btn-white" disabled={!items||!pagination.hasMore} onClick={()=>onQuery({...query,page:query.page+1})}>Next</button></nav>}</>;
}
