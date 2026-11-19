/** The short reference shown in the Inbox. UUIDs remain the stored identity. */
export function ticketReference(id:string){return `#${id.slice(0,8).toUpperCase()}`}

/** An indexed range over IDs sharing the eight hexadecimal digits. */
export function ticketReferenceRange(reference:string):[string,string]|null{
 const prefix=/^#?([a-f0-9]{8})$/i.exec(reference)?.[1].toLowerCase()
 return prefix?[prefix,prefix+'g']:null
}
