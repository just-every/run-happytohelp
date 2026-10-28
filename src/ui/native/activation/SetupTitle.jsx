import useSetup from './useSetup';
import {open} from './setup-model';

/** The Setup page's heading: "Nearly ready" while any step is open to the person, needed or optional (or the snapshot has
 * not arrived), "All set" once none is. Skipped items are not open, so they never hold it at "Nearly ready". */
export default function SetupTitle({projectId}) {
 const {data}=useSetup(projectId);
 return data&&open(data).length===0?<span data-setup-state="ready">All set</span>:<span data-setup-state="needs-you">Nearly ready</span>;
}
