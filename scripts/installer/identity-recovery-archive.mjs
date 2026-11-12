// Live recovery state is credential material. Keep revocation history but require
// a fresh custody bind after restore, even under a copied runtime configuration.
export const recoveryPrivateTables=['identity_recovery_requests','identity_recovery_approvals','identity_recovery_nonces','identity_recovery_limits','identity_recovery_assertions'];
export function recoveryArchiveRow(table,row){return table==='identity_recovery_authority'?{...row,acknowledged_generation:null}:row}
export async function recoveryArchiveSafety({db,tables}){
 const statements=[];
 for(const name of recoveryPrivateTables)if(tables[name])statements.push(db.prepare(`DELETE FROM "${tables[name].replaceAll('"','""')}"`));
 if(tables.identity_recovery_authority)statements.push(db.prepare(`UPDATE "${tables.identity_recovery_authority.replaceAll('"','""')}" SET acknowledged_generation=NULL`));
 if(statements.length)await db.batch(statements);
}
