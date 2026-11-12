import assert from 'node:assert/strict'
import {client as nativeClient} from '../../journeys/kit/http.mjs'

// Native auth responses can contain session values. Status failures must never
// dump those bodies (or rejected selector values) into test output.
export function client(origin){
 const app=nativeClient(origin)
 return {...app,call:async(path,{status,...options}={})=>{
  const response=await app.call(path,options)
  if(status!==undefined)assert.equal(response.status,status,`${options.method||(options.body===undefined?'GET':'POST')} ${new URL(path,origin).pathname}: unexpected status`)
  return response
 }}
}
