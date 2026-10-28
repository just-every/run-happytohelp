import {createNetwork} from './network.mjs';
import connections from '../../connections/browser-network.mjs';
// Each viewport's synthetic credential identifies an isolated provider fixture.
// The application still uses its real connection, approval and idempotency state.
const accounts=new Map();
export default request=>{
 if(!['api.stripe.com','api.hubapi.com','synthetic-happytohelp-1.myshopify.com','synthetic-happytohelp-1.my.salesforce.com'].includes(new URL(request.url).hostname))return connections(request);
 const credential=request.headers.get('authorization')||request.headers.get('x-shopify-access-token')||'';
 if(!accounts.has(credential))accounts.set(credential,createNetwork());
 return accounts.get(credential).handle(request);
};
