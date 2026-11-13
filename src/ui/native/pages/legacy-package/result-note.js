/** Counts-only note shared by the result disclosure and Business-step clipboard action. */
export function resultNote(result){
 const {run,tables={},attachments,work,diagnostics}=result;
 const note={runId:run.runId,manifestSha256:run.manifestSha256,
  projectId:run.projectId,sourceProjectId:run.sourceProjectId,state:run.state,errorCode:run.errorCode,
  verification:result.verification,verifiedAt:result.verifiedAt,tables,
  excluded:result.excluded,journalEqualsPackage:result.journalEqualsPackage,
  attachments,work,attempt:result.attempt,sourceCustody:result.sourceCustody,adoption:result.adoption,syntheticOnly:result.syntheticOnly};
 // Older runners omit diagnostics. Keep that absence honest and every existing result field intact.
 if(diagnostics){
  const {installationWork,baseline}=diagnostics;
  note.diagnostics={scope:diagnostics.scope,conversationCount:diagnostics.conversationCount,
   distinctDeltaSourceIds:diagnostics.distinctDeltaSourceIds,
   incompleteDeltaRuns:diagnostics.incompleteDeltaRuns,
   sampleConversationIds:diagnostics.sampleConversationIds,
   ...(installationWork?{installationWork:{before:installationWork.before,
    after:installationWork.after,qualification:installationWork.qualification}}:{}),
   ...(baseline?{baseline:{kind:baseline.kind,at:baseline.at,
    counts:baseline.counts,installation:baseline.installation}}:{})};
 }
 return JSON.stringify(note,null,2);
}
