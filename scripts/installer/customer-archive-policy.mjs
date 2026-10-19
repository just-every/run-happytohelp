import {workflowArchiveStagedSafety} from './workflow-archive-safety.mjs';

/** Validate tenant ownership in staged copies before a portable archive becomes live. */
export async function customerArchiveStagedSafety(context){
 const {db,tables}=context,table=name=>`"${tables[name].replaceAll('"','""')}"`,checks=[];
 if(tables.contact_companies&&tables.companies&&tables.contacts)checks.push(`SELECT 1 FROM ${table('contact_companies')} member LEFT JOIN ${table('companies')} account ON account.id=member.company_id AND account.project_id=member.project_id LEFT JOIN ${table('contacts')} contact ON contact.id=member.contact_id AND contact.project_id=member.project_id WHERE account.id IS NULL OR account.merged_into IS NOT NULL OR contact.id IS NULL LIMIT 1`);
 if(tables.company_domains&&tables.companies)checks.push(`SELECT 1 FROM ${table('company_domains')} domain LEFT JOIN ${table('companies')} account ON account.id=domain.company_id AND account.project_id=domain.project_id WHERE account.id IS NULL OR account.merged_into IS NOT NULL LIMIT 1`);
 if(tables.companies)checks.push(`SELECT 1 FROM ${table('companies')} source LEFT JOIN ${table('companies')} target ON target.id=source.merged_into AND target.project_id=source.project_id WHERE source.merged_into IS NOT NULL AND (target.id IS NULL OR source.id=source.merged_into) LIMIT 1`);
 if(tables.csv_customer_imports&&tables.csv_customer_import_rows)checks.push(`SELECT 1 FROM ${table('csv_customer_import_rows')} row LEFT JOIN ${table('csv_customer_imports')} run ON run.id=row.run_id AND run.project_id=row.project_id WHERE run.id IS NULL LIMIT 1`);
 if(checks.length){const results=await db.batch(checks.map(sql=>db.prepare(sql)));if(results.some(result=>result.results.length))throw Error('Customer archive contains an invalid company or import relationship');}
 return workflowArchiveStagedSafety(context);
}
