import {useEffect,useState} from 'react';
import {nativeRequest} from '../transport';
import {setupStore} from './setup-store';
import {needs} from './setup-model';

/** How many Setup steps still need the owner, for the Settings row and Setup's own menu row. One read of the snapshot as
 *  stored (never a check), then whatever Setup's own loop finds while that page is open. Only owners and admins can read
 *  it; for anyone else, and until it arrives, nothing is counted (a failed read is logged, as the live counts' are). */
export default function useSetupNeeds(projectId,enabled) {
 const [count,setCount]=useState(0);
 useEffect(()=>{
  setCount(0);
  if(!projectId||!enabled)return;
  const store=setupStore(projectId),take=data=>{if(data)setCount(needs(data).length);};
  let live=true;
  const stop=store.watch(()=>take(store.snapshot().data));
  take(store.snapshot().data);
  nativeRequest(store.path,{cache:'no-store'}).then(result=>{if(live&&!store.snapshot().data)take(result.data);}).catch(error=>console.warn(error.message));
  return ()=>{live=false;stop();};
 },[projectId,enabled]);
 return count;
}
