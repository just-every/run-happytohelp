import assert from 'node:assert/strict';
import {hostedSourceApi} from './hosted-export-resources.mjs';

// Populate the owned fixture through D1's real query API. Source preparation
// must not depend on a long-lived Wrangler preview connection; the public
// export command still selects and reads the actual deployed bindings.
export function hostedSourceD1(source){
 const api=hostedSourceApi(source),path='/d1/database/'+source.databaseId+'/query';
 const value=input=>input instanceof ArrayBuffer?Array.from(new Uint8Array(input)):ArrayBuffer.isView(input)?Array.from(new Uint8Array(input.buffer,input.byteOffset,input.byteLength)):input;
 const query=async batch=>{
  const result=await api.request(path,{method:'POST',body:{batch:batch.map(({sql,params})=>({sql,params:params.map(value)}))}});
  assert.equal(result.length,batch.length,'the real D1 API acknowledges every fixture statement');
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
