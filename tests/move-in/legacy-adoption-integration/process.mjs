import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {inspect} from 'node:util'

const entry=fileURLToPath(import.meta.url)

// Native database snapshots and other Miniflare lifecycles must not share the
// event loop that controls the measured Worker's inspector. Its child process
// also owns its Worker PIDs, startup gate, inspector and teardown independently.
export async function adoptionIntegrationJourney(){
 const env={...process.env};delete env.NODE_TEST_CONTEXT
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[entry],{env,stdio:['ignore','inherit','inherit']})
  console.log('IMPORT_ADMISSION_PROCESS',JSON.stringify({parent:process.pid,child:child.pid}))
  child.once('error',reject)
  child.once('close',(code,signal)=>code===0?resolve():reject(new Error(`Measured adoption process failed: ${signal??code}`)))
 })
}

if(process.argv[1]===entry){
 try{const {adoptionIntegrationJourney}=await import('./journey.mjs');await adoptionIntegrationJourney()}
 catch(error){console.error('IMPORT_ADMISSION_PROCESS_FAILURE',inspect(error,{depth:null,colors:false,maxArrayLength:null,maxStringLength:null}));process.exitCode=1}
}
