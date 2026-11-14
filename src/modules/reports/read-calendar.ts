/** Binary lookup in the validated workspace-calendar boundaries. Each cohort
 * row visits log2(days) scalar expressions, rather than scanning every day.
 * The only generated SQL is integer array offsets; dates stay bound as JSON. */
export function calendarDaySQL(days:number,start=0,end=days):string{
 if(end-start===1)return `json_extract(?5,'$[${start}].date')`
 const middle=Math.floor((start+end)/2)
 return `CASE WHEN c.created_at<json_extract(?5,'$[${middle}].start') THEN ${calendarDaySQL(days,start,middle)} ELSE ${calendarDaySQL(days,middle,end)} END`
}
