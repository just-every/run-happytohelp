import type {Actor} from '../../platform/env'
export interface FieldCondition {fieldId:string;operator:'equals'|'not_equals'|'includes'|'present';value?:string|number|boolean}
export interface FormField {fieldId:string;required:boolean;condition?:FieldCondition}
export interface FieldTranslation {label?:string;description?:string;options?:Record<string,string>}
export interface FormTranslation {title?:string;description?:string;submitLabel?:string;fields?:Record<string,FieldTranslation>}
export interface FormConfig {title:string;description:string;submitLabel:string;locale:string;enabled:boolean;fields:FormField[];translations:Record<string,FormTranslation>}
export interface RequestForm extends FormConfig {id:string;projectId:string;updatedAt:number}
export interface PublicField {id:string;type:string;label:string;description:string;required:boolean;options:Array<{value:string;label:string}>;validation:Record<string,unknown>;condition?:FieldCondition}
export interface PublicForm {id:string;projectId:string;title:string;description:string;submitLabel:string;locale:string;defaultLocale:string;locales:string[];fields:PublicField[];turnstileSiteKey:string|null;updatedAt:number}
export interface FormIdentity {actor:Actor;sessionHash:string}
export interface Submission {subject:string;message:string;fields:Record<string,unknown>;localId:string}
export interface StoredField {id:string;project_id:string;name:string;type:string;required:number;options_json:string;validation_json:string;read_roles_json:string;write_roles_json:string;updated_at:number}
