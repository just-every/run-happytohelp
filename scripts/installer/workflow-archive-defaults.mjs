// Explicit pre150 transition only: trigger-free restore inserts projects after
// migration152's backfill ran. Current archives keep their own rule lifecycle.
const definition=JSON.stringify({name:'Close solved tickets after 4 days',kind:'time',position:1000,conditions:{all:[{field:'status_category',op:'eq',value:'solved'}],any:[]},time:{field:'solved_at',hours:96},actions:[{type:'status',status_id:'closed'}]});
export const workflowLegacyRestoreSql=`
INSERT OR IGNORE INTO workflow_rules(id,project_id,name,kind,position,state,draft_json,published_version,owner_id,created_at,updated_at)
SELECT 'workflow:auto-close:'||id,id,'Close solved tickets after 4 days','time',1000,'published','${definition}',1,'system',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) FROM projects;
INSERT OR IGNORE INTO workflow_rule_versions(rule_id,project_id,version,definition_json,published_by,published_at)
SELECT id,project_id,1,draft_json,'system',created_at FROM workflow_rules WHERE id='workflow:auto-close:'||project_id AND state='published' AND published_version=1;`;
