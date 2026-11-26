export async function dashboardSession(response:Response){
 if(response.status===401){await response.body?.cancel();return false}
 if(response.status===503){await response.body?.cancel();return {busy:true} as const}
 const actor=await response.json() as {projectId?:string;role:string;twoFactor?:'verify'|'enrol';error?:string|{message?:string}}
 if(!response.ok)throw new Error(typeof actor.error==='string'?actor.error:actor.error?.message||`Request failed (${response.status})`)
 return {projectId:actor.projectId,editorAuthorized:Boolean(!actor.twoFactor&&actor.projectId&&['owner','admin'].includes(actor.role)),twoFactor:actor.twoFactor}
}
