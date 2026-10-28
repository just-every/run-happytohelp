import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {memberReaders,articleVisible,readerSet,type Readers} from './door'
import {combineReaders,describeReaders} from './readers'
import {listAccessibleArticles} from './experience'
import {articleCanonicalUrl} from './public-sources'
import {createBlocks,referenceVisibility} from './reference-store'
export async function insertArticleReference(env:Env,projectId:string,articleId:string,operatorId:string,readers:Readers,mode:'text'|'link',locale?:string){
 const audience=combineReaders(memberReaders(operatorId),readers)
 const articles=await listAccessibleArticles(env,projectId,{readers:audience,locale}),article=articles.find(row=>row.id===articleId)
 if(!article)throw new HTTPException(404,{message:'Not found'})
 const url=new URL(articleCanonicalUrl(env,projectId,article.slug));if(article.locale!=='en')url.searchParams.set('locale',article.locale)
 const text=mode==='text'?article.content:`[${article.title.replace(/[\[\]\\]/g,'')}](${url.href})`
 const [token]=await createBlocks(env,projectId,[{kind:mode,text,title:article.title,url:url.href,sources:['article:'+article.id]}])
 return {token,preview:{title:article.title,content:article.content,url:url.href,mode},references:await referenceVisibility(env,projectId,token,operatorId,readers)}
}
export async function pickerArticles(env:Env,projectId:string,operatorId:string,readers:Readers,query?:string,locale?:string){
 const [articles,recipients]=await Promise.all([listAccessibleArticles(env,projectId,{readers:memberReaders(operatorId),query,locale}),describeReaders(env,projectId,readers)])
 return Promise.all(articles.map(async article=>{const blockedRecipients=[];for(const recipient of recipients)if(!await articleVisible(env,projectId,article.id,readerSet([recipient])))blockedRecipients.push({...recipient,reason:'Current knowledge access required'});return {...article,insertable:blockedRecipients.length===0,blockedRecipients}}))
}
