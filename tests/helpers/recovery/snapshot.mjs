import {validateStoredSearch,markSearchShadows} from '../search-index.mjs';
const canonicalRow = row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));

export async function snapshot(storage) {
  const search=await validateStoredSearch(storage.inspect);
  const schema = (await storage.inspect({sql: "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY type,name"})).results;
  const rows = {};
  for (const table of schema.filter(entry => entry.type === 'table')) {
    rows[table.name] = (await storage.inspect({sql: `SELECT * FROM "${table.name.replaceAll('"', '""')}"`})).results.map(canonicalRow).sort();
  }
  const objects = [];
  let cursor;
  do {
    const page = await storage.inspect({list: {limit: 2, ...(cursor ? {cursor} : {})}});
    for (const object of page.objects) objects.push(await storage.inspect({key: object.key}));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  objects.sort((a, b) => a.key.localeCompare(b.key));
  if(search)markSearchShadows(rows,search.shadows);
  return {schema, rows, objects};
}
