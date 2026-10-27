// Steps of one public-door flow share one registration. Preserve the assertion's
// original name in the failure so a merged journey still identifies its proof.
export async function runSteps(steps){
 for(const [name,run] of steps){
  try{await run()}catch(error){
   if(error&&typeof error==='object')error.message=`${name}: ${error.message}`;
   throw error;
  }
 }
}
