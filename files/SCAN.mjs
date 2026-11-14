import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {carriesCredential} from '/workspace/run-happytohelp/node_modules/@runeditrun/rer/scripts/publish-check/credential_literals.mjs';
const source=readFileSync('/workspace/run-happytohelp/node_modules/@runeditrun/rer/scripts/publish-check/credential_literals.mjs','utf8');
const rules=[...source.matchAll(/\{kind:'([^']+)',regex:\/(.+)\/g\}/g)].map(m=>({name:m[1],regex:new RegExp(m[2])}));
const head=execFileSync('git',['rev-parse','HEAD']).toString().trim();
execFileSync('git',['diff','--exit-code','HEAD']);
const hits=[];const files=execFileSync('git',['ls-files','-z']).toString().split('\0').filter(Boolean);
for(const path of files){const text=readFileSync(path,'utf8');if(!carriesCredential(text))continue;text.split('\n').forEach((line,i)=>{for(const rule of rules)if(rule.regex.test(line))hits.push({path,line:i+1,rule:'SEC-1 '+rule.name});});}
console.log(JSON.stringify({head,version:'0.2.117',scanner:'published credential_literals.mjs exact-format patterns (comment identifies SEC-1)',files:files.length,rules:rules.length,hits},null,2));
process.exitCode=hits.length?1:0;
