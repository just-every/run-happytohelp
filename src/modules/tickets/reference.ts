/** A display reference only. UUIDs remain the identity in storage, links and APIs. */
export function ticketReference(id:string){return `#${id.slice(0,8).toUpperCase()}`}
