// Independent named cases of one public-door journey all run, even after a failure.
export async function runSteps(steps){
 const failures=[];
 for(const [name,run] of steps){
  try{await run()}catch(cause){
   failures.push(new Error(`${name}: ${cause?.message??cause}`,{cause}));
  }
 }
 if(failures.length)throw new AggregateError(failures,failures.map(error=>error.message).join('\n'));
}
