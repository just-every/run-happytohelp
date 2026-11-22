/** Only passive document, image and media formats may open in the browser. */
const inlineTypes=new Set([
 'application/pdf','text/plain',
 'image/png','image/jpeg','image/gif','image/webp','image/avif','image/bmp','image/x-icon','image/vnd.microsoft.icon',
 'audio/mpeg','audio/ogg','audio/wav','audio/webm','audio/mp4',
 'video/mp4','video/ogg','video/webm','video/quicktime',
])
export function mediaResponseHeaders(storedType:string,filename:string):Record<string,string>{
 const type=storedType.split(';',1)[0].trim().toLowerCase()
 const contentType=/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)?type:'application/octet-stream'
 const disposition=inlineTypes.has(contentType)?'inline':'attachment'
 return {
  'Content-Type':contentType==='text/plain'?'text/plain; charset=utf-8':contentType,
  'Content-Disposition':`${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"sandbox; default-src 'none'",
 }
}
