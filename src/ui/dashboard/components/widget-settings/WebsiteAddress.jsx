import React,{useEffect,useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import {useConfirmation} from '../../../native/pages/ConfirmDialog';

export default function WebsiteAddress({projectId, register, value, numbered = false}) {
 const [addresses,setAddresses]=useState([]),[canManage,setCanManage]=useState(false),[error,setError]=useState('');
 const {ask,dialog}=useConfirmation(),path=`/api/management/projects/${projectId}/widget-addresses`;
 useEffect(()=>{let active=true;nativeRequest(path).then(result=>{if(active){setAddresses(result.allowedAddresses||[]);setCanManage(result.canManage);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path]);
 const hasOtherWebsites=addresses.some(address=>address!==value&&!address.includes('*'));
 const remove=address=>ask({title:'Remove this website address?',confirmLabel:'Remove address',busyLabel:'Removing…',body:address.includes('*')?<p>Remove {address} from your allowed list.</p>:<p>New visitors on {address} won’t be able to start chat.</p>,run:async()=>{await nativeRequest(path,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({address})});setAddresses(current=>current.filter(value=>value!==address));}});
 return <section className="settings-section widget-code__section">
  <h2 className={numbered ? 'widget-code__step-heading' : undefined}>{numbered && <span aria-hidden="true">1. </span>}<label htmlFor={numbered ? 'widget-code-website' : 'widget-website'}>Your website address</label></h2>
  <input id={numbered ? 'widget-code-website' : 'widget-website'} type="url" className="form-control" placeholder="https://chargedesk.com" required {...register('allowed_origin')} value={value} aria-describedby={numbered ? 'widget-code-address-hint' : 'widget-address-hint'}/>
  <p id={numbered ? 'widget-code-address-hint' : 'widget-address-hint'} className="form-text">The address people type to open your site, for example https://chargedesk.com. {hasOtherWebsites ? 'Chat works on this site and your other allowed websites.' : 'This is the only website address listed for chat.'}</p>
  <p>Saving replaces the previous address.{addresses.length>0&&' Your other allowed addresses stay on the list.'}</p>
  <details><summary>Where do I find it?</summary><p>Open your website and copy its main address from your browser’s address bar.</p></details>
  {!numbered && <details><summary>Details for your developer</summary><p>Use the scheme, hostname and optional port, without a path, query or fragment.</p></details>}
  {addresses.length>0&&<details><summary>Other allowed addresses</summary><ul>{addresses.map(address=><li key={address} style={{overflowWrap:'anywhere'}}>{address}{canManage&&<> <button type="button" className="btn btn-white btn-sm" onClick={()=>remove(address)}>Remove address<span className="visually-hidden"> {address}</span></button></>}</li>)}</ul></details>}
  {error&&<p role="alert">{error}</p>}{dialog}
  <button type="submit" name="widget_save" value="website" className="btn btn-primary mt-3">Save website address</button>
 </section>;
}
