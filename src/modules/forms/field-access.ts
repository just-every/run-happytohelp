// Publishing a question grants customer input, independently of which teammates
// may edit its answer. Read restrictions still keep internal fields private.
export const publicReadRoles=['owner','admin','operator','collaborator','api']
export function everyRoleReads(readRoles:string[],customRoles:string[]=[]){
 return readRoles.length===0||[...publicReadRoles,...customRoles].every(role=>readRoles.includes(role))
}
/** Use the same rule again at commit, including the workspace's current custom roles. */
export function publicFieldReadSql(alias:string){
 return `(json_array_length(${alias}.read_roles_json)=0 OR NOT EXISTS(
 SELECT 1 FROM (SELECT value id FROM json_each('${JSON.stringify(publicReadRoles)}') UNION ALL
 SELECT id FROM project_roles WHERE project_id=${alias}.project_id) required
 WHERE required.id NOT IN (SELECT value FROM json_each(${alias}.read_roles_json))))`
}
