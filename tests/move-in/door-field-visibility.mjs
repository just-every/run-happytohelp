import assert from 'node:assert/strict'
const stamp='2024-01-01T00:00:00Z'
export function withDoorFields(fixture){
 const records=[...fixture.records,...[[9551,'Staff triage',false],[9552,'Order reference',true]].map(([id,title,visible])=>({ticket_field:{id,title,type:'text',active:true,required:false,visible_in_portal:visible,editable_in_portal:visible,agent_can_edit:true,created_at:stamp,updated_at:stamp}}))]
 return {...fixture,records,body:records.map(JSON.stringify).join('\n'),byKind:{...fixture.byKind,ticket_field:2}}
}
export async function doorFieldVisibility(h,project){
 const path=`/api/forms/projects/${project}/forms`,json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const catalogue=(await h.call(`/api/dashboard/projects/${project}/ticket-fields`)).data,internal=catalogue.find(field=>field.name==='Staff triage'),visible=catalogue.find(field=>field.name==='Order reference'),choices=(await h.call(path)).fields
 assert.ok(internal&&visible);assert.ok(!choices.some(field=>field.id===internal.id));assert.ok(choices.some(field=>field.id===visible.id),'the generic door carries visible fields into form choices')
 assert.equal((await h.raw(path,json({title:'Staff only',fields:[{fieldId:internal.id}],enabled:false}))).response.status,400)
 const made=(await h.call(path,json({title:'Order request',fields:[{fieldId:visible.id}],enabled:true}))).data
 assert.ok((await h.call(`/api/forms/${project}/${made.id}`)).data.fields.some(field=>field.id===visible.id),'the published public form serves its visible field')
 await h.call(path+'/'+made.id,{method:'DELETE'})
}
