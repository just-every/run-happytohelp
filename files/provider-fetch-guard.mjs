import {appendFileSync} from 'node:fs';
globalThis.fetch=async()=>{
 appendFileSync('/tmp/hh-docs-provider-requests.txt','unexpected request\n');
 throw Error('Documentation dry-run proof refuses outbound fetch');
};
