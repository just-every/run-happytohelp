const TABLE_SNAPSHOT_CONCURRENCY=16

// Bound Miniflare's loopback connections while retaining every table in input order.
export async function snapshotTables(app,tables){
 const results=new Array(tables.length)
 let next=0
 await Promise.all(Array.from({length:Math.min(TABLE_SNAPSHOT_CONCURRENCY,tables.length)},async()=>{
  while(next<tables.length){
   const index=next++,name=tables[index]
   results[index]=await app.sql('SELECT * FROM "'+name.replaceAll('"','""')+'"')
  }
 }))
 return results
}
