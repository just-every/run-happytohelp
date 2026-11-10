import {type Row,type MappedRow,stable} from './types'
import {rewriteText,type UrlCounts} from './media-urls'
import {nativeUrl,type MediaIndex} from './media-index'
import {unreproducedWidgetKeys} from './legacy-widget'

/** The canonical columns that hold legacy storage URLs, by mapped table. */
export const urlColumns:Record<string,string>={messages:'content',knowledge_articles:'content',project_settings:'settings_json',user_settings:'avatar_url',ai_profiles:'avatar_url'}
const emptyIndex=(projectId:string):MediaIndex=>({projectId,files:new Map()})

/** One run's rewrite: each legacy storage URL in a mapped value that names a file `index` holds becomes that file's
 * native URL, and a file served by the file door brings its `legacy_import_files` row with the row that names it.
 * Counts what it rewrote and left, and the widget keys of each imported workspace that are not reproduced. */
export function mediaRewrite(index:MediaIndex|undefined,projectId=''){
 const media=index??emptyIndex(projectId),urls:UrlCounts={rewritten:0,left:0},widget:Record<string,number>={}
 /** The row of each file-door file a value names, by media id. */
 const doors=new Map<string,MappedRow>()
 const resolve=(key:string)=>{
  const file=media.files.get(key)
  const url=file&&nativeUrl(media,file)
  if(url&&file!.conversationId===undefined)doors.set(file!.mediaId,{table:'legacy_import_files',row:{project_id:media.projectId,media_id:file!.mediaId,object_key:file!.objectKey,content_type:file!.contentType,filename:file!.filename,audience:file!.audience},key:['project_id','media_id']})
  return url
 }
 const text=(value:unknown)=>typeof value==='string'?rewriteText(value,resolve,urls):value
 /** A settings document's logo and widget background; every other setting is left as it is. */
 const settings=(json:unknown)=>{
  if(typeof json!=='string')return json
  const value=JSON.parse(json) as Row,logo=text(value.logo_url),theme=(value.widget_settings as Row|undefined)?.theme as Row|undefined,background=text(theme?.background_image)
  if(logo===value.logo_url&&background===theme?.background_image)return json
  return stable({...value,...(logo!==undefined?{logo_url:logo}:{}),...(theme&&background!==undefined?{widget_settings:{...value.widget_settings as Row,theme:{...theme,background_image:background}}}:{})})
 }
 /** The value `column` of `table` holds after the rewrite. */
 const value=(table:string,raw:unknown)=>table==='project_settings'?settings(raw):text(raw)
 return {
  value,
  /** The file rows the values rewritten since the last call name, then forgotten. */
  takeDoors(){const rows=[...doors.values()];doors.clear();return rows},
  /** A source row's mapped rows with their URLs rewritten, followed by the file rows they name. */
  map(table:string,row:Row,mapped:MappedRow[]):MappedRow[]{
   if(table==='projects'&&mapped.some(m=>m.table==='project_settings'))for(const key of unreproducedWidgetKeys(row))widget[key]=(widget[key]??0)+1
   const rewritten=mapped.map(m=>{const column=urlColumns[m.table];if(!column||m.row[column]===undefined)return m;const next=value(m.table,m.row[column]);return next===m.row[column]?m:{...m,row:{...m.row,[column]:next}}})
   return [...rewritten,...this.takeDoors()]
  },
  summary(){return {mediaUrls:{...urls},widgetNotReproduced:{...widget}}},
 }
}
export type MediaRewrite=ReturnType<typeof mediaRewrite>
