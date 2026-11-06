/** A named reason a Zendesk step stopped. The code is shown to the owner; it never carries a token, code or link. */
export class ZendeskError extends Error{readonly code:string;readonly status?:number;constructor(code:string,status?:number){super(code);this.code=code;this.status=status}}
