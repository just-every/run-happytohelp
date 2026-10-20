export type Kind='contacts'|'companies'
export interface Definition {id:string;name:string;type:string;options_json:string}
export interface Contact {id:string;name:string|null;email:string|null;external_id:string|null;metadata_json:string;is_verified:number;created_at:number;company_id:string|null}
export interface Company {id:string;name:string;attributes_json:string;portal_company_view:number;revision:number;created_at:number;updated_at:number;merged_into:string|null;domains:string[]}
export interface DomainMatch {domain:string;companyId:string;companyName:string}
export interface PlannedRow {row:number;action:'create'|'update'|'skip';reason:string;data:Record<string,unknown>;domainMatch:DomainMatch|null;entityId:string|null;before:Contact|Company|null;after:Contact|Company|null}
export interface Snapshot {erasures:number;contacts:Contact[];companies:Company[];definitions:Definition[]}
export interface PreviewInput {kind:Kind;csv:string;mapping:Record<string,string>;matchDomains:boolean}
export interface ImportRun {id:string;project_id:string;kind:Kind;status:'preview'|'applied'|'undone'|'erased';actor_id:string;created_at:number;applied_at:number|null;undone_at:number|null}
