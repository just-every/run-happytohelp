/** Shape data stays independent of mapping: custody audits rejected records too. */
export function helpScoutShapes(s:any){
 const {record:r,array:a,nullable:n,string:t,integer:i,id,reference:ref,opaque:o,boolean:b}=s,iso={type:'iso'},person={...r({id,type:t,first:n(t),last:n(t),email:n(t)},['id']),person:true}
 const links=r({self:r({href:t}),next:r({href:t}),previous:r({href:t}),prev:r({href:t}),first:r({href:t}),last:r({href:t}),page:r({href:t,templated:b})})
 const page=r({number:i,size:i,totalElements:i,totalPages:i},['number','size','totalElements','totalPages'])
 const tag=r({id,name:t,tag:t,slug:t,color:n(t),styles:o,ticketCount:i,createdAt:iso,updatedAt:iso})
 const attachment=r({id,filename:t,mimeType:t,size:i,width:i,height:i,state:t,_links:r({self:r({href:t}),data:r({href:t}),download:r({href:t})})},['id','filename','mimeType'])
 const thread=r({id,type:t,state:t,status:t,body:n(t),createdAt:iso,customer:person,createdBy:person,assignedTo:person,savedReplyId:n(id),to:a(t),cc:a(t),bcc:a(t),source:o,openedAt:n(iso),linkedConversationId:n(id),action:o,rating:o,scheduled:o,_embedded:r({attachments:a(attachment)})},['id','type','state'])
 const common={id,createdAt:iso,updatedAt:iso,_links:links},article={...common,collectionId:id,categories:a(id),status:t,hasDraft:b,name:t,text:t,number:i,slug:t,publicUrl:t,related:a(id),keywords:a(t),popularity:i,viewCount:i,createdBy:id,updatedBy:id,lastPublishedAt:n(iso)}
 return {
  'helpscout/organization':r({id,name:t,website:n(t),description:n(t),location:n(t),logoUrl:n(t),note:n(t),domains:a(t),phones:a(o),brandColor:n(t),customerCount:i,conversationCount:i,properties:a(o)},['id','name']),
  'helpscout/team':r({...common,name:t,timezone:t,photoUrl:n(t),mention:t,initials:t},['id','name','updatedAt']),
  'helpscout/contact':{...r({...common,firstName:t,lastName:t,draft:b,_embedded:r({emails:a(r({id,value:t,type:t})),phones:o,chats:o,socialProfiles:o,websites:o,properties:o}),gender:t,jobTitle:t,location:t,organization:t,organizationId:n(id),photoType:t,photoUrl:t,age:i,conversationCount:i,background:o},['id']),person:true},
  'helpscout/conversation':r({...common,number:i,threads:i,folderId:id,mailboxId:id,type:t,state:t,status:t,subject:t,preview:t,primaryCustomer:person,createdBy:person,assignee:person,closedByUser:person,userUpdatedAt:iso,closedAt:n(iso),tags:a(tag),cc:a(t),bcc:a(t),customFields:o,customerWaitingSince:o,source:o,snooze:o,nextEvent:o,_embedded:r({threads:a(thread)})},['id','primaryCustomer']),
  'helpscout/thread-page':r({_embedded:r({threads:a(thread)},['threads']),_links:links,page},['_embedded','_links','page']),
  'helpscout/tag':tag,'helpscout/tag-name':r({name:t}),
  'helpscout/collection':r({...common,siteId:id,slug:t,visibility:t,name:t,description:t,publicUrl:t,number:i,order:i,articleCount:i,publishedArticleCount:i,createdBy:id,updatedBy:id}),
  'helpscout/category':r({...common,collectionId:id,defaultSort:t,slug:t,visibility:t,name:t,description:t,publicUrl:t,number:i,order:i,articleCount:i,publishedArticleCount:i,createdBy:id,updatedBy:id}),
  'helpscout/article':r(article),'helpscout/article-ref':r(article),'helpscout/article-draft':r({article:r(article)}),
  'helpscout/$page':r({value:page}),'helpscout/$links':r({value:links}),'helpscout/$count':r({value:i})
 }
}
