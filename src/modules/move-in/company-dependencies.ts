import type {SourceRecord} from '../import-kit/src/types'
import {recordKey,type PreparedMapping} from './types'
import {nativeId} from './readers/common'
import {companyKind} from './readers/companies'
import type {Vendor} from './types'

/** A rejected company cannot leave a contact pointing to an absent native row.
 * An existing, explicitly edited company remains usable through its held source
 * claim; its current membership and permissions are never overwritten. */
export function rejectUnavailableCompanies(projectId:string,records:SourceRecord[],prepared:PreparedMapping){
 const unavailable=new Set<string>()
 for(const record of records){const key=recordKey(record);if(!prepared.rejections.has(key)||prepared.retained?.has(key)||record.kind!==companyKind(record.namespace as Vendor))continue;unavailable.add(nativeId(projectId,record.namespace as Vendor,'company',record.sourceId))}
 for(const record of records){const key=recordKey(record);for(const effect of prepared.effects.get(key)??[])if(effect.targetKind==='contact'&&((effect.value as any).tables.contact_companies??[]).some((row:any)=>unavailable.has(row.company_id)))prepared.rejections.set(key,'contact_company_unavailable')}
}
