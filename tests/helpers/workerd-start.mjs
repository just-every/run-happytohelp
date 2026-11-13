// A PID-discovery window must contain only its own new Worker. All test app
// starters share this gate; migrations, requests and cleanup run outside it.
let starting=Promise.resolve()
export async function startWorkerd(start){
 const prior=starting;let release
 starting=new Promise(resolve=>{release=resolve})
 await prior
 try{return await start()}finally{release()}
}
