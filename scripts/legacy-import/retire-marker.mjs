// The legacy retire soft-deletes the company's project and, in the same transaction, every live
// contact of it, all with one marker time (UTC, to the second) and without touching updated_at.
// The sweep after the retire passes that time as --retire-marker, so a contact the retire marked
// reads as the row legacy exported before the retire, and its customer's arrivals import live.

const sqlForm=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const isoForm=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;

/** The marker as epoch ms: `YYYY-MM-DD HH:MM:SS` (UTC, as the retire records it) or ISO-8601
 * UTC (`YYYY-MM-DDTHH:MM:SS[.fff]Z`). Anything else, an impossible date included, is refused. */
export function parseRetireMarker(value){
  const parts=typeof value==='string'?(sqlForm.exec(value)??isoForm.exec(value)):null;
  const [year,month,day,hour,minute,second,millis='000']=parts?parts.slice(1):[];
  const ms=parts?Date.UTC(+year,+month-1,+day,+hour,+minute,+second,+millis):NaN;
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`)
    throw Error('--retire-marker needs the retire\'s UTC time as YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS[.fff]Z');
  return ms;
}

/** Contact rows read through the marker: a row whose deleted_at is the marker's instant becomes
 * the same row with deleted_at null (kept, not removed, so its digest is the pre-retire row's).
 * Without a marker, or for another table, rows are returned as read. */
export function unmarkRetired(table,rows,marker){
  if(marker===undefined||table!=='contacts')return {rows,ignored:0};
  let ignored=0;
  const read=rows.map(row=>{if(instant(row.deleted_at)!==marker)return row;ignored++;return {...row,deleted_at:null};});
  return {rows:read,ignored};
}

// A legacy time as the exporter writes it (`2026-11-25T09:30:00Z`, any fraction) or as MySQL
// shows it (`2026-11-25 09:30:00`), always UTC; anything else is no instant.
const rowForm=/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z?$/;
function instant(value){
  if(typeof value!=='string'||!rowForm.test(value))return undefined;
  const [, fraction='']=/(\.\d+)?Z?$/.exec(value).slice(0,2);
  const ms=Date.parse(value.slice(0,19).replace(' ','T')+(fraction?fraction.slice(0,4):'')+'Z');
  return Number.isFinite(ms)?ms:undefined;
}
