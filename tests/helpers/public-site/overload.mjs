import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

/** The Worker entry's public doors under D1's overload, at every D1 call position a request makes (counted on a
 * calm run): a read refused once or twice is retried to the calm answer, a read refused throughout and a write
 * refused once answer 503 with Retry-After and a JSON error, never 500, and a write is never re-run. */
export async function publicSiteOverloadProof(){
 const host='help.example',app=await startApp({bindings:{PUBLIC_HELP_HOSTS:JSON.stringify({[host]:'busy-help'})}})
 try{
  const w=await app.seedWorkspace('public-busy'),p=w.projectId
  const knowledge=(path,body)=>app.ok(`/api/knowledge/${p}/${path}`,{token:w.tokens.owner,body})
  await knowledge('categories',{title:'Public guides'})
  await knowledge('articles',{slug:'busy-guide',title:'Busy guide',summary:'busy guide',content:'Instructions.',status:'published'})
  await app.db.prepare("INSERT INTO public_project_aliases(slug,project_id) VALUES('busy-help',?)").bind(p).run()
  const door=(path,{headers={},...options}={})=>app.call(path,{...options,headers:{'x-test-door':'public',...headers}})
  const fault=(at,overloads)=>({'x-test-fault':'d1-overloaded','x-test-statement-at':String(at),...(overloads?{'x-test-overloads':String(overloads)}:{})})
  const positions=async(path,options={})=>{const calm=await door(path,{...options,headers:{'x-test-meter-d1':'1'}}),count=Number(calm.headers.get('x-test-d1-statements'));assert.ok(count>0,path+' reads D1');return {calm,count}}
  const busy=(answer,label)=>{
   assert.equal(answer.status,503,label+' '+JSON.stringify(answer.data).slice(0,300));assert.equal(typeof answer.data.error,'string',label)
   const wait=Number(answer.headers.get('retry-after'));assert.ok(Number.isInteger(wait)&&wait>=1&&wait<=30,label+' Retry-After is whole seconds within D1\'s window')
  }
  // An article view records its own view event, linked from the page as the request form's read receipt.
  const stable=data=>typeof data==='string'?data.replace(/afterReading=[0-9a-f-]{36}/g,'afterReading=<view event>'):data
  const reads=[`/help/${p}`,`/help/busy-help/busy-guide`,'/busy-help',`/help/${p}/requests`,`/portal/${p}`].map(path=>({path})).concat([{path:'/',base:`https://${host}`},{path:'/busy-guide',base:`https://${host}`}])
  const proven=[]
  for(const {path,base} of reads){
   const label=(base??'')+path,{calm,count}=await positions(path,{base})
   assert.ok(calm.status<500,label+' answers when calm')
   await Promise.all(Array.from({length:count},(_,index)=>index+1).map(async at=>{
    const passing=await door(path,{base,headers:fault(at,2)})
    assert.equal(passing.status,calm.status,`${label} at ${at}`);assert.deepEqual(stable(passing.data),stable(calm.data),`${label} answers the same after a passing overload at ${at}`)
    busy(await door(path,{base,headers:fault(at)}),`${label} at ${at}`)
   }))
   proven.push(`${label}:${count}`)
  }
  // The alias write: refused once at any position, it answers 503, runs only the statements before it, and writes nothing.
  const alias=`/api/public-site/projects/${p}/alias`,write=slug=>({method:'PUT',token:w.tokens.owner,body:{slug}})
  const {calm,count}=await positions(alias,write('busy-calm'))
  assert.equal(calm.status,200,JSON.stringify(calm.data))
  await Promise.all(Array.from({length:count},(_,index)=>index+1).map(async at=>{
   const slug=`busy-alias-${at}`,refused=await door(alias,{...write(slug),headers:{...fault(at,1),'x-test-meter-d1':'1'}})
   busy(refused,`${alias} at ${at}`)
   assert.equal(Number(refused.headers.get('x-test-d1-statements')),at-1,`${alias} at ${at} is not re-run`)
   assert.equal(await app.first('SELECT slug FROM public_project_aliases WHERE slug=?',slug),null,`${alias} at ${at} writes nothing`)
  }))
  proven.push(`PUT ${alias}:${count}`)
  console.log('PUBLIC_PROOF overload positions '+proven.join(' '))
 }finally{await app.close()}
}
