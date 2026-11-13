const reasons={
 unsupported_note_bucket:'This export has private notes in separate threads. Import needs the matching historical-note reader before it can continue.',
 import_authority_revoked:'Sign in as the original installation owner, renew approval, then resume.',
 adoption_approval_required:'Renew the original installation owner’s approval for this package.',
 source_invalidated:'This source was invalidated and cannot be resumed or replayed.',
 source_expired:'This source expired and cannot be resumed or replayed.',
 native_conflict:'Existing workspace data conflicts with this export. No conflicting data was overwritten.',
 canonical_target_conflict:'A record in this export conflicts with existing workspace data. Resolve the conflict in a fresh export before trying again.',
 object_conflict:'An attachment conflicts with an existing stored file. Resolve the file conflict in a fresh export before trying again.',
 invalid_scope:'The export contains records outside its declared workspace. Export only the intended workspace before trying again.',
 row_too_large:'A source record is too large to import safely. Reduce that record in a fresh export before trying again.',
 quantum_too_large:'This import step exceeds the safe processing limit. Repackage the export into smaller parts before trying again.',
};
export const pauseReason=code=>code?(reasons[code]||`Import paused: ${code.replaceAll('_',' ')}. Review the package and its verification details before resuming.`):'';
