export interface ApiClient {get(path:string):Promise<any>;post(path:string,body:unknown):Promise<any>}
export interface ApiRecord {kind:string;payload:any}
export interface SourceAgent {id:string;email:string|null;name:string;deleted:boolean}
export interface ApiAttachment {ticketId:string;partId:string;id:string;filename:string;contentType:string;url:string;private:boolean;size:number|null}
export type ApiCursor=Record<string,any>
export interface ApiPage {records:ApiRecord[];attachments:ApiAttachment[];agents:SourceAgent[];next:ApiCursor|null;counts?:Record<string,number>}
export type ApiVendor='zendesk'|'intercom'|'freshdesk'|'helpscout'
export interface Task {path:string;kind:string;mode?:'ticket'|'detail';body?:any;page?:number;context?:any}
export interface ReadResult {records?:ApiRecord[];attachments?:ApiAttachment[];agents?:SourceAgent[];tasks?:Task[]}
export interface Reader {initial(since:number|null):Task[];read(client:ApiClient,task:Task):Promise<ReadResult>}
