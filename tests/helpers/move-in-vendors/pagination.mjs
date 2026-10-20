export function pageSlice(url, rows, {size=100, pageParam='page', sizeParam='per_page', cursorParam=null}={}) {
    const limit = Math.min(size, Math.max(1, Number(url.searchParams.get(sizeParam)) || size));
    const cursor = cursorParam ? url.searchParams.get(cursorParam) : null;
    const offset = cursor ? decodeCursor(cursor) : (Math.max(1, Number(url.searchParams.get(pageParam)) || 1)-1)*limit;
    const result = rows.slice(offset,offset+limit), more = offset+result.length < rows.length;
    const next = new URL(url);
    if (cursorParam) next.searchParams.set(cursorParam,encodeCursor(offset+result.length));
    else next.searchParams.set(pageParam,String(Math.floor(offset/limit)+2));
    return {rows:result,offset,size:limit,more,next:more?next.href:null,cursor:encodeCursor(offset+result.length),
        number:Math.floor(offset/limit)+1,pages:Math.ceil(rows.length/limit),total:rows.length};
}
export const encodeCursor = offset => Buffer.from(`fixture-offset:${offset}`).toString('base64url');
export function decodeCursor(cursor) {
    const match=/^fixture-offset:(\d+)$/.exec(Buffer.from(cursor,'base64url').toString());
    if (!match) throw new Error('invalid fixture cursor');
    return Number(match[1]);
}
export function hal(url, key, rows, size=50) {
    const p=pageSlice(url,rows,{size});
    return {_embedded:{[key]:p.rows},page:{number:p.number,size:p.size,totalElements:p.total,totalPages:p.pages},
        _links:{self:{href:url.href},...(p.next?{next:{href:p.next}}:{})}};
}
export function docsPage(url,key,rows) {
    const p=pageSlice(url,rows,{size:50,sizeParam:'pageSize'});
    return {[key]:{page:p.number,pages:p.pages,count:p.total,items:p.rows}};
}
export function newer(rows,since) {
    if (!since) return rows;
    const at = /^\d+(\.\d+)?$/.test(String(since)) ? Number(since)*1000 : Date.parse(since);
    return rows.filter(row=>row.updatedAt >= at);
}
