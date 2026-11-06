/** Each conformance round reads the report window holding the owner initializer's protected feedback, written today. */
const day=ms=>new Date(ms).toISOString().slice(0,10)
export default async function({now}){
 return {values:{report:{start:day(now-29*86_400_000),end:day(now+86_400_000)}}}
}
