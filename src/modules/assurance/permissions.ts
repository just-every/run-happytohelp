import type {Permission} from '../access/catalogue'
const root='/api/assurance/projects/:projectId'
const rules:Record<string,Permission>={
 [`GET ${root}`]:'settings.manage',
 [`PUT ${root}`]:'settings.manage',
 [`POST ${root}/evidence`]:'settings.manage',
 [`POST ${root}/evidence/:id/revoke`]:'settings.manage',
 [`POST ${root}/activate`]:'settings.manage',
 [`GET ${root}/report`]:'data.export',
}
export const assuranceRouteRule=(method:string,path:string)=>rules[`${method} ${path}`]
