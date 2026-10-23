import assert from 'node:assert/strict';
import {cloudflare} from '@runeditrun/rer/modules/deploy-kit/provider';

// D1's query API keeps the archive's guarded batches atomic without carrying
// its large transfer metadata over a Wrangler preview connection.
export function hostedD1({accountId,databaseId,token}){
 assert.match(databaseId,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
 const api=cloudflare({accountId,token,maxRequests:5000}),path='/d1/database/'+databaseId+'/query';
 const value=input=>input instanceof ArrayBuffer?Array.from(new Uint8Array(input)):ArrayBuffer.isView(input)?Array.from(new Uint8Array(input.buffer,input.byteOffset,input.byteLength)):input;
 const query=async batch=>{
  const result=await api.request(path,{method:'POST',body:{batch:batch.map(({sql,params})=>({sql,params:params.map(value)}))}});
  assert.equal(result.length,batch.length,'D1 must acknowledge every archive statement');
  return result;
 };
 const prepare=(sql,params=[])=>({sql,params,
  bind(...next){return prepare(sql,next)},
  async all(){return (await query([{sql,params}]))[0]},
  async run(){return (await query([{sql,params}]))[0]},
  async first(column){const row=(await query([{sql,params}]))[0].results[0]??null;return column===undefined?row:row?.[column]??null},
 });
 return {prepare,batch:query};
}
