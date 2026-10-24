// Fixture preparation uses the same authenticated browser transport as the UI.
// No APIRequestContext socket pool, mutation retries or application substitutes.
export function browserRequest(page,url,{method='GET',json,text,bytes,headers={}}={}){
 return page.evaluate(async({url,method,json,text,bytes,headers})=>{
  const init={method,credentials:'same-origin',headers:{...headers}};
  if(json!==undefined){init.headers['Content-Type']='application/json';init.body=JSON.stringify(json);}
  else if(bytes!==undefined)init.body=new Uint8Array(bytes);
  else if(text!==undefined)init.body=text;
  const response=await fetch(url,init);
  return {status:response.status,ok:response.ok,data:response.headers.get('content-type')?.includes('json')?await response.json():await response.text()};
 },{url,method,json,text,bytes,headers});
}
