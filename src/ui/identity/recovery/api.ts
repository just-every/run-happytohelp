export const recoveryRoot='/api/identity/owner-recovery'
export interface RecoveryStatus {requestId:string;state:string;mode:string;expiresAt:number;approved:number;required:number;ready:boolean;needsPassword:boolean}
export async function recoveryApi(path:string,body?:unknown,capability?:string){
 const response=await fetch(recoveryRoot+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(capability?{'X-Recovery-Capability':capability}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'same-origin',cache:'no-store'})
 const data:any=await response.json()
 if(!response.ok)throw new Error(data.error||'Recovery could not continue. Please restart.')
 return data
}
export const browserSecret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
export async function nonceHash(secret:string){const bytes=Uint8Array.from(atob(secret.replace(/-/g,'+').replace(/_/g,'/')+'='),char=>char.charCodeAt(0));return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
