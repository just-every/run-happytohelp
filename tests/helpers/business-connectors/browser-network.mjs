import business from './network.mjs';
import connections from '../../connections/browser-network.mjs';
export default request=>['api.stripe.com','api.hubapi.com','synthetic-happytohelp-1.myshopify.com','synthetic-happytohelp-1.my.salesforce.com'].includes(new URL(request.url).hostname)?business(request):connections(request);
