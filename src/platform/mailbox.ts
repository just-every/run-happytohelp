import {HTTPException} from 'hono/http-exception'

/** A single bare mailbox, never a display name or header list. */
export function mailboxAddress(value:unknown):string|null{
 if(typeof value!=='string'||/[\r\n\0]/.test(value))return null
 const address=value.trim().toLowerCase()
 if(address.length>254||!/^[^\s@<>(),:;"\\]+@[^\s@<>(),:;"\\]+\.[^\s@<>(),:;"\\]+$/.test(address))return null
 const [local,domain]=address.split('@')
 if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return null
 return domain.split('.').every(label=>/^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(label))?address:null
}

/** Null or empty clears the preference; every nonempty value must be usable. */
export function providedEmail(value:unknown){
 if(value===null||typeof value==='string'&&!value.trim())return null
 const address=mailboxAddress(value)
 if(!address)throw new HTTPException(400,{message:'provided_email must be a valid mailbox'})
 return address
}
