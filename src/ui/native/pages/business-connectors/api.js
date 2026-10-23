import {nativeRequest} from '../../transport';
export const names={shopify:'Shopify',stripe:'Stripe',orbit:'Orbit',hubspot:'HubSpot',salesforce:'Salesforce'};
export const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export const command=(path,body,method='POST')=>nativeRequest(path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
