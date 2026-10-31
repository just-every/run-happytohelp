import assert from 'node:assert/strict'
import {createServer} from 'node:http'

// Consume a real upstream response, hold it while competitors run, then reset
// the caller's HTTP socket. Only delivery is lost; the application runs intact.
export async function holdLostResponse(origin,path,{token,body}){
 const received=Promise.withResolvers(),release=Promise.withResolvers()
 const relay=createServer(async(request,response)=>{
  try{
   const chunks=[];for await(const chunk of request)chunks.push(chunk)
   const upstream=await fetch(origin+request.url,{method:request.method,headers:{Authorization:request.headers.authorization,'Content-Type':'application/json'},body:Buffer.concat(chunks)})
   received.resolve({status:upstream.status,data:await upstream.json()})
   await release.promise;response.destroy()
  }catch(error){received.reject(error);response.destroy()}
 })
 await new Promise(done=>relay.listen(0,'127.0.0.1',done))
 const pending=fetch(`http://127.0.0.1:${relay.address().port}`+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}).then(()=>null,error=>error)
 const close=async()=>{release.resolve();try{assert.ok(await pending instanceof Error,'the committed response must be lost')}finally{await new Promise(done=>relay.close(done))}}
 try{return {committed:await received.promise,close}}catch(error){await close();throw error}
}
