/** RFC 7636 S256: a 43-character base64url verifier from 32 random bytes. */
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
export const randomToken=()=>base64url(crypto.getRandomValues(new Uint8Array(32)))
export async function codeChallenge(verifier:string){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))}
