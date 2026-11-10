import {deflateSync} from 'node:zlib'
import {DatabaseSync} from 'node:sqlite'
import {legacyBundle} from '../legacy-bundle.mjs'
const {digest,stable}=await import('../../../src/modules/legacy-import/types.ts')
const {columnsDigest}=await import('../../../src/modules/legacy-import/state.ts')

const storage='https://storage.happytohelp.com'
/** A solid-colour PNG, so a browser shows the imported image. */
export function png([r,g,b],size=24){
 const crc=bytes=>{let c=~0;for(const byte of bytes){c^=byte;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1}return ~c>>>0}
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(body));return Buffer.concat([length,body,check])}
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header.set([8,2,0,0,0],8)
 const rows=Buffer.concat(Array.from({length:size},()=>Buffer.from([0,...Array.from({length:size},()=>[r,g,b]).flat()])))
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])
}

/** The legacy journey's workspace with what a large imported workspace holds: a message linking another message's
 * attachment by its storage URL (and one whose file the export does not carry), a logo (a carried avatar-xl variant), a
 * widget background, a teammate avatar on the bucket's S3 path, an assistant's default artwork, a published article's
 * image and a draft's, and widget overrides with a disabled schedule and a dashboard colour. */
export async function mediaWidgetBundle({widget=true}={}){
 const {bundle,date}=await legacyBundle(),t=bundle.tables,later=at=>new Date(Date.parse(date)+at*1000).toISOString()
 const files={shot:[44,161,229],logo:[22,140,118],'logo-xl':[22,140,118],bg:[200,200,40],'u-avatar':[80,70,229],'art-img':[229,120,40],'draft-img':[120,40,229]}
 const where={shot:['p/conv','shot'],logo:['p/avatar','logo'],'logo-xl':['p/avatar','logo-avatar-xl'],bg:['p/widget_background_image','bg'],'u-avatar':['avatars','u'],'art-img':['p/articles','diagram'],'draft-img':['p/articles','draft']}
 const bytes=Object.fromEntries(Object.entries(files).map(([id,colour])=>[id,png(colour)]))
 for(const [id,[directory,filename]] of Object.entries(where)){
  const object_key=`legacy/projects/p/media/${id}`
  t.media.push({id,project_id:'p',directory,filename,extension:'png',object_key,mime_type:'image/png',filename_original:`${filename}.png`,size:bytes[id].length,created_at:date,...(id==='shot'?{conversation_id:'conv',message_id:'m-shot'}:{}),...(id==='logo-xl'?{original_media_id:'logo',variant_name:'avatar-xl'}:{})})
  bundle.objects.push({key:object_key,dataBase64:bytes[id].toString('base64'),sha256:await digest(bytes[id])})
 }
 t.mediables=[['shot','Message','m-shot','attachment'],['logo','Project','p','avatar'],['bg','Project','p','widget_background_image'],['u-avatar','User','u','avatar'],['art-img','Article','article','media'],['draft-img','Article','draft','media']].map(([media_id,model,mediable_id,tag],i)=>({id:`link-${i}`,media_id,mediable_type:`App\\Models\\${model}`,mediable_id,tag,order:0}))
 // The conversation's customer opens it from the widget, so this workspace's copy of her is not blocked.
 delete t.contacts[0].blocked_at
 t.contacts.push({id:'c2',project_id:'p',name:'Another customer',identifier:'customer-2',created_at:date})
 t.conversations.push({id:'conv-c2',project_id:'p',contact_id:'c2',created_at:date})
 t.messages.push({id:'m-shot',project_id:'p',conversation_id:'conv',contact_id:'c',content:'Here is my screen',created_at:later(2),local_id:'shot-1'},
  {id:'m-link',project_id:'p',conversation_id:'conv',agent_id:'u',content:`Thanks, I can see ${storage}/p/conv/shot.png and not ${storage}/p/conv/gone.png yet.`,created_at:later(3),local_id:'shot-2'})
 t.users[0].avatar_url='https://s3.amazonaws.com/storage.happytohelp.com/avatars/u.png'
 t.ais[0].avatar_url='https://cdn.happytohelp.com/img/avatars/male-1.png'
 t.articles[0].content=`Help text\n\n![Diagram](${storage}/p/articles/diagram.png)`
 t.articles.push({id:'draft',project_id:'p',category_id:'cat',slug:'draft-guide',title:'Draft guide',content:`Soon ![Draft](${storage}/p/articles/draft.png)`,status:'draft',updated_at:date})
 Object.assign(t.projects[0],{avatar_url:`${storage}/p/avatar/logo-avatar-xl.png`,is_availability_schedule_enabled:0,availability_schedule:{days:['1','2','3','4','5'],time_from:'09:00',time_to:'17:00',message:'We are back on Monday'},metadata:{dashboard:{primary_color:'#d01c1c'}},
  widget_settings:widget?{theme:{chat:{user:{background:'#5046e5'}},background_image:`${storage}/p/widget_background_image/bg.png`},text:{message:{placeholder_message:'Ask the imported team'}},settings:{show_glow:{on_ai_typing:true}}}:null})
 return {bundle,bytes}
}

/** Put the journey's rewritten rows back as the importer before this change wrote them: legacy values in the URL columns,
 * the project's settings with its raw widget tree and schedule, no file-door rows, and each row's import state recomputed
 * for what it then holds (state.ts), as that importer recorded it. */
export async function asImportedBefore(database,bundle){
 const db=new DatabaseSync(database),t=bundle.tables
 try{
  const state=db.prepare('SELECT columns,digest FROM legacy_import_state WHERE target_table=? AND target_key=?'),restate=db.prepare('UPDATE legacy_import_state SET digest=? WHERE target_table=? AND target_key=?')
  const current=(table,keyColumn,key)=>({...db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn}=?`).get(key)})
  // A row the seed changed since import stays changed: only a row still as imported is recorded as that importer wrote it.
  const put=async(table,keyColumn,key,values)=>{
   const recorded=state.get(table,key),asImported=recorded&&await columnsDigest(current(table,keyColumn,key),JSON.parse(recorded.columns))===recorded.digest
   db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(c=>`${c}=?`).join(',')} WHERE ${keyColumn}=?`).run(...Object.values(values),key)
   if(asImported)restate.run(await columnsDigest(current(table,keyColumn,key),JSON.parse(recorded.columns)),table,key)
  }
  for(const message of t.messages.filter(m=>m.content.includes('storage.happytohelp')))await put('messages','id',message.id,{content:message.content})
  for(const article of t.articles)await put('knowledge_articles','id',article.id,{content:article.content})
  await put('user_settings','user_id','u',{avatar_url:t.users[0].avatar_url})
  const project=t.projects[0],settings=JSON.parse(db.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').get('p').settings_json)
  delete settings.is_presence_away_enabled;delete settings.widget_team_display;delete settings.widget_settings
  await put('project_settings','project_id','p',{settings_json:stable({...settings,...(project.widget_settings?{widget_settings:project.widget_settings}:{}),availability_schedule:project.availability_schedule,logo_url:project.avatar_url})})
  db.prepare("DELETE FROM legacy_import_state WHERE target_table='legacy_import_files'").run();db.prepare('DELETE FROM legacy_import_files').run()
 }finally{db.close()}
}

/** What an import wrote for the rows the rewrite touches, and their import state: equal after a fresh import and after an upgrade. */
export function rewrittenState(database){
 const db=new DatabaseSync(database,{readOnly:true})
 try{
  const rows=sql=>db.prepare(sql).all().map(row=>({...row}))
  return {messages:rows("SELECT id,content FROM messages WHERE project_id='p' ORDER BY id"),articles:rows("SELECT id,title,content FROM knowledge_articles WHERE project_id='p' ORDER BY id"),avatars:rows("SELECT user_id,avatar_url FROM user_settings ORDER BY user_id"),
   settings:rows("SELECT settings_json,updated_at FROM project_settings WHERE project_id='p'"),files:rows('SELECT * FROM legacy_import_files ORDER BY media_id'),
   state:rows("SELECT * FROM legacy_import_state WHERE target_table IN ('messages','knowledge_articles','user_settings','project_settings','legacy_import_files','ai_profiles') ORDER BY target_table,target_key")}
 }finally{db.close()}
}
