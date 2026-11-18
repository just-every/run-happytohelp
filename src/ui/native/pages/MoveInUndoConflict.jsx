import React from 'react';

export default function MoveInUndoConflict({report,error}){
 const conflict=report?.undoConflicts;
 if(report?.undoConflictScan)return <p role="status">Checking which records blocked undo. No more records are being reversed.</p>;
 if(!conflict)return error==='NATIVE_EDIT_CONFLICT'?<p role="alert">Undo stopped to preserve records changed or used after the import. Choose Resume undo to identify the records that still block it.</p>:null;
 const reason={changed:'was changed in HappyToHelp after the import.',missing:'was removed in HappyToHelp after the import.',referenced:'is used by records or access created after the import.'};
 return <div role="alert"><p>Undo stopped to preserve your later work.</p>
  {conflict.records.length>0&&<ul>{conflict.records.map((record,index)=><li key={index}>{record.kind}: {record.name} {reason[record.reason]}</li>)}</ul>}
  {conflict.total>conflict.records.length&&<p>{conflict.total-conflict.records.length} more conflicting {conflict.total-conflict.records.length===1?'record is':'records are'} not shown.</p>}
  {conflict.total===0&&<p>The record that blocked undo has changed again. Resume undo to check its current state.</p>}
  <p>To resume, restore changed or removed records to their imported state and remove later references or access first. Then choose Resume undo. To keep your later work, leave the remaining imported records in place. Undo never overwrites that work.</p>
 </div>;
}
