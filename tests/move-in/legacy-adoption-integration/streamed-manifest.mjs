import {request} from 'node:http'

// Keep this a chunked request, crossing the real 2 MiB limit by one byte.
// End the final chunk synchronously, then observe the server's response. An
// async fetch body can still be writing its terminator when the server refuses
// the body, replacing the real 413 response with a client-side EPIPE.
export async function streamedManifestStatus(url,headers){
 let upload
 try{return await new Promise((resolve,reject)=>{
  upload=request(url,{method:'PUT',headers},response=>{
   response.once('error',reject)
   response.once('end',()=>resolve(response.statusCode))
   response.resume()
  })
  upload.once('error',reject)
  const chunk=Buffer.alloc(512*1024)
  for(let i=0;i<4;i++)upload.write(chunk)
  upload.end(Buffer.from(' '))
 })}finally{upload?.destroy()}
}
