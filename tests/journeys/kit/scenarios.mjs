import assert from 'node:assert/strict';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Scenarios through a family's public doors, registered by their module and run by
// the journey that owns their claim. Every scenario belongs to exactly one journey.
export const registry=[];
export function phases(url){const file=basename(fileURLToPath(url),'.mjs');return (name,fn)=>{assert.equal(typeof fn,'function',name);registry.push({file,name,fn})}}
export async function runPhases(selected){
 assert.ok(selected.length,'a journey owns scenarios');
 for(const phase of selected){try{await phase.fn()}catch(error){if(error&&typeof error==='object')error.message=`${phase.file}: ${phase.name}: ${error.message}${error.cause?` (${error.cause.code||''} ${error.cause.message||error.cause})`:''}`;throw error}}
}
export const any=(file,...patterns)=>phase=>phase.file===file&&(!patterns.length||patterns.some(pattern=>pattern.test(phase.name)));
export const either=(...selectors)=>phase=>selectors.some(select=>select(phase));
// Checks that the claims partition the registered scenarios, then returns a journey factory.
export function journeys(claims,scope=()=>true){
 for(const phase of registry.filter(scope)){const owners=Object.entries(claims).filter(([,[,select]])=>select(phase)).map(([key])=>key);assert.equal(owners.length,1,`${phase.file}: ${phase.name} is owned by ${owners.join(', ')||'no journey'}`)}
 return key=>{const [title,select]=claims[key];return [title,()=>runPhases(registry.filter(phase=>scope(phase)&&select(phase)))]}
}

// One behavior, several inputs. Keep a fresh fixture inside check for each input;
// a failure names its input and still fails the owning journey.
export function matrix(inputs,check){
 assert.ok(inputs.length,'a matrix has at least one input');
 assert.equal(typeof check,'function');
 return async()=>{
  for(const input of inputs){
   try{await check(input)}catch(error){
    if(error&&typeof error==='object')error.message=`${JSON.stringify(input)}: ${error.message}`;
    throw error;
   }
  }
 };
}
