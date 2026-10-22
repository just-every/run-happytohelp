import {nativeRequest} from '../transport';

// One observation loop per workspace, shared by every Setup list that is mounted for it. The first subscriber loads the snapshot and asks the server to observe on its own
// (`POST /check {auto:true}`); the loop keeps asking while something still waits and the tab is visible, and stops with
// the last subscriber. A GET never does provider work: only these POSTs and the explicit footer control do.
const pollMs = 15000, maxPolls = 40;
const stores = new Map();

function createStore(projectId) {
 const path = `/api/management/projects/${encodeURIComponent(projectId)}/activation`;
 let state = {data: null, error: '', busy: false, skipBusy: false};
 let timer = 0, polls = 0, stopped = true, refs = 0, inflight = null, skipping = null;
 const listeners = new Set();
 const set = patch => { state = {...state, ...patch}; listeners.forEach(listener => listener()); };
 // A skipped step is still watched: an observation beats a skip, so a widget seen later turns into a confirmed row on its own.
 const waiting = data => Boolean(data?.steps?.some(step => step.placement === 'needs_you' || step.placement === 'skipped'));
 const post = async auto => {
  const result = await nativeRequest(`${path}/check`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(auto ? {auto: true} : {}), cache: 'no-store'});
  if (!stopped) set({data: result.data, error: ''});
  return result.data;
 };
 // A single request at a time: a poll that lands while another is running joins it instead of repeating it.
 const observe = auto => {
  // A skip in flight goes first, so a snapshot taken before it can never replace the one that includes it.
  if (skipping) return skipping.then(() => observe(auto));
  if (inflight) return inflight;
  set({busy: true});
  inflight = post(auto).catch(error => { if (!stopped) set({error: error.message}); }).finally(() => { inflight = null; if (!stopped) set({busy: false}); });
  return inflight;
 };
 const schedule = () => {
  clearTimeout(timer);
  if (stopped || !waiting(state.data) || polls >= maxPolls) return;
  timer = setTimeout(async () => {
   if (!document.hidden) { polls += 1; await observe(true); }
   schedule();
  }, pollMs);
 };
 const onVisible = () => { if (!document.hidden && !stopped && waiting(state.data)) { polls = 0; observe(true).then(schedule); } };
 const start = async () => {
  document.addEventListener('visibilitychange', onVisible);
  try {
   const {data} = await nativeRequest(path, {cache: 'no-store'});
   if (stopped) return;
   set({data});
   await observe(true);
  } catch (error) { if (!stopped) set({error: error.message}); }
  schedule();
 };
 return {
  subscribe(listener) {
   listeners.add(listener); refs += 1;
   if (refs === 1) { stopped = false; start(); }
   return () => {
    listeners.delete(listener); refs -= 1;
    if (refs === 0) { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); state = {data: null, error: '', busy: false, skipBusy: false}; }
   };
  },
  snapshot: () => state,
  // Follows every snapshot the loop takes without starting it (the Settings row's count while Setup is open).
  watch(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  path,
  // The footer's explicit "Check again": a check that is not marked automatic, so the server runs it now.
  checkAgain: async () => { await inflight; await observe(false); polls = 0; schedule(); },
  // Skip for now, or undo it: stored on the server for the workspace, never in the browser. The answer is the snapshot.
  skip: (step, skipped) => {
   if (skipping) return skipping;
   skipping = (async () => {
    set({skipBusy: true, error: ''});
    await inflight;
    try {
     const result = await nativeRequest(`${path}/skip`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({step, skipped}), cache: 'no-store'});
     if (!stopped) set({data: result.data});
     polls = 0;
    } catch (error) { if (!stopped) set({error: error.message}); }
    finally { skipping = null; if (!stopped) set({skipBusy: false}); schedule(); }
   })();
   return skipping;
  },
 };
}

export function setupStore(projectId) {
 if (!stores.has(projectId)) stores.set(projectId, createStore(projectId));
 return stores.get(projectId);
}
