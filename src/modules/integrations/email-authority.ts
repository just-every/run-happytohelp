// This Symbol can only come from trusted application code, never a JSON request.
export const emailAuthority=Symbol('current email sending authority')
export interface EmailAuthority {sql:string;params:unknown[]}
