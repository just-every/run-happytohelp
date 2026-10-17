import {mentionText} from './mentions';

// Keep stable identities in the submitted note and readable names in its editor.
export function addEditableMention(mentions,member){
 const existing=mentions.find(item=>item.id===member.id);
 if(existing)return {mentions,mention:existing};
 const token=mentionText(member),name=token.slice(2,token.indexOf('](user:'));
 let label=`@${name}`,number=2;
 while(mentions.some(item=>item.label===label))label=`@${name} (${number++})`;
 const mention={id:member.id,label,token};
 return {mentions:[...mentions,mention],mention};
}
export function editableMentionDraft(content){
 let mentions=[];
 const text=String(content).replace(/@\[([^\]\n]{1,120})\]\(user:([^\s)\n]{1,200})\)/g,(_,name,id)=>{
  const result=addEditableMention(mentions,{name,id});mentions=result.mentions;return result.mention.label;
 });
 return {text,mentions};
}
export function submitMentionDraft(content,mentions){
 if(!mentions.length)return content;
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const labels=[...mentions].sort((a,b)=>b.label.length-a.label.length);
 return content.replace(new RegExp(`(?:${labels.map(item=>escape(item.label)).join('|')})(?![\\p{L}\\p{N}_])`,'gu'),label=>labels.find(item=>item.label===label).token);
}
