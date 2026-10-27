import {evaluateSuggestion} from './checks/index.mjs';
import {evaluateHumanVoice} from './checks/human-voice.mjs';
export function evaluateTrainingCase(definition:any,result:any,variant:string){
 if(definition.family==='human_voice')return evaluateHumanVoice(definition,result.output);
 if(definition.family==='profile')return {passed:result.valid===true,failures:result.valid?[]:[{check:'profile_schema_and_evidence',actual:result.response}]};
 if(definition.family==='monitoring'){const expected=definition.expected?.analysis,actual=result.stages?.analysis;const allowed=definition.expected?.acceptable_analysis_evidence_ids||expected?.evidence_ids_any_of;const decision=actual?.decision===expected?.decision&&actual?.help_type===expected?.help_type;const evidence=expected?.decision!=='insight'||!!allowed?.some((id:string)=>actual?.evidence_ids?.includes(id));return {passed:decision&&evidence,failures:[...(!decision?[{check:'monitoring_decision',expected,actual}]:[]),...(!evidence?[{check:'monitoring_evidence',expected:allowed,actual:actual?.evidence_ids}]:[])]};}
 if(definition.family==='customer_reply'||definition.family==='procedure'){
  const output=result.output,checks=evaluateSuggestion({...definition,expected:{...definition.expected,min_responses:1,max_responses:1}},{...result,variant,output:{responses:[typeof output==='string'?output:output?.response||result.response]}});
  if(definition.family==='procedure'){
   const expected=definition.scenario==='denied'?'denied':definition.scenario==='timeout'?'timeout':'ok';
   if(!result.sandbox?.receipts?.length||result.sandbox.receipts.some((r:any)=>r.status!==expected||!definition.procedure.tools.includes(r.tool))){checks.passed=false;checks.failures.push({check:'required_sandbox_read',expected});}
  }
  return checks;
 }
 return evaluateSuggestion(definition,{...result,variant});
}
