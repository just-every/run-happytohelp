export function sessionCookie(token: string, requestUrl: string, maxAge=86400) {
 const url = new URL(requestUrl)
 const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
 return `h2h_session=${token}; Path=/; HttpOnly;${localHttp ? '' : ' Secure;'} SameSite=Lax; Max-Age=${maxAge}`
}
export const clearSessionCookie=(requestUrl:string)=>sessionCookie('',requestUrl,0)
