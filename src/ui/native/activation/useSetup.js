import {useSyncExternalStore} from 'react';
import {setupStore} from './setup-store';

/** The workspace's setup snapshot, kept current by the shared observation loop (see setup-store.js). */
export default function useSetup(projectId) {
 const store = setupStore(projectId);
 const state = useSyncExternalStore(store.subscribe, store.snapshot);
 return {...state, checkAgain: store.checkAgain, skip: store.skip, tryLocally: store.tryLocally};
}
