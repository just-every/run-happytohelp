// A named acceptance step executes inside its owning public-door journey. It
// never registers a test, and retains the original failure as well as its name.
export async function step(name,run){
 try{return await run()}catch(error){
  if(error&&typeof error==='object')error.message=`${name}: ${error.message}`;
  throw error;
 }
}
