// A closed response projection: neither native content nor origin/journal values leave here.
export interface TicketRow {position:string;source_id:string;conversation_id:string|null;messages:number;notes:number;contact_linked:number}
export interface ArticleRow {position:string;source_id:string;article_id:string|null;status:'published'|'draft'|null}
export const ticketProjection=(row:TicketRow)=>({sourceId:row.source_id,conversationId:row.conversation_id,nativePresent:row.conversation_id!==null,messageCount:row.messages,noteCount:row.notes,contactLinked:row.contact_linked===1})
export const articleProjection=(row:ArticleRow)=>({sourceId:row.source_id,articleId:row.article_id,nativePresent:row.article_id!==null,status:row.status})
