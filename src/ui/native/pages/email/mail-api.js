import {nativeRequest} from '../../transport';
export const mailboxPath = projectId => `/api/management/projects/${encodeURIComponent(projectId)}/mailboxes`;
export const jsonBody = (method,value) => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export function readableDate(value) {
 if(!value)return 'None recorded';
 const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
 return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
export const safeJson = value => {
 if(typeof value !== 'string')return value;
 try{return JSON.parse(value);}catch{return value;}
};
export const readMail = (path,init) => nativeRequest(path,init);
