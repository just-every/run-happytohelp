/** What a workspace role may do. Custom roles choose from these; built-in roles hold their defaults. */
export const PERMISSIONS={
 'conversations.reply':'Reply to customers',
 'conversations.notes':'Add internal notes',
 'conversations.follow':'Follow conversations',
 'conversations.manage':'Assign, resolve, tag and change conversations',
 'contacts.manage':'Create and edit contacts',
 'knowledge.read':'Read internal help articles',
 'knowledge.edit':'Write and edit help articles and sources',
 'knowledge.publish':'Publish help articles',
 'reports.view':'View reports',
 'settings.manage':'Change workspace settings',
 'members.manage':'Invite teammates and change roles',
 'integrations.install':'Install integrations, credentials and connected computers',
 'refunds.approve':'Approve refunds and billing changes',
 'data.import':'Import data from another help desk',
 'data.export':'Export data',
 'data.erase':'Erase customers and delete records',
 'audit.view':'View the security log',
} as const
export type Permission=keyof typeof PERMISSIONS
export const ALL_PERMISSIONS=Object.keys(PERMISSIONS) as Permission[]

const AGENT:Permission[]=['conversations.reply','conversations.notes','conversations.follow','conversations.manage','contacts.manage','knowledge.read','knowledge.edit','knowledge.publish','reports.view']
/** Built-in roles. A collaborator (light agent) views permitted tickets, adds internal notes and follows. */
export const BASE_PERMISSIONS:Record<'owner'|'admin'|'operator'|'collaborator',Permission[]>=Object.assign(Object.create(null),{
 owner:ALL_PERMISSIONS,
 admin:ALL_PERMISSIONS,
 operator:AGENT,
 collaborator:['conversations.notes','conversations.follow'],
})
export const ROLE_LABELS:Record<string,string>=Object.assign(Object.create(null),{owner:'Owner',admin:'Admin',operator:'Agent',collaborator:'Collaborator'})

/** A custom role narrows its base: anything outside the base's defaults is dropped. */
export function customPermissions(base:keyof typeof BASE_PERMISSIONS,requested:unknown){
 const allowed=new Set(BASE_PERMISSIONS[base])
 return Array.isArray(requested)?[...new Set(requested.filter((value):value is Permission=>typeof value==='string'&&allowed.has(value as Permission)))]:[]
}

/** What the dashboard shows a member of their own role in one workspace. */
export function projectAccess(role:string,key:string|null,name:string|null,base:string|null,permissions:string|null){
 if(key==='collaborator'&&role==='operator')return {key,name:ROLE_LABELS.collaborator,permissions:BASE_PERMISSIONS.collaborator}
 if(key&&name&&base&&Object.hasOwn(BASE_PERMISSIONS,base)){let requested:unknown=[];try{requested=JSON.parse(permissions||'[]')}catch{}return {key,name,permissions:customPermissions(base as 'admin'|'operator'|'collaborator',requested)}}
 return {key:role,name:ROLE_LABELS[role]??role,permissions:BASE_PERMISSIONS[role as keyof typeof BASE_PERMISSIONS]??[]}
}
