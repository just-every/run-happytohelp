import useSetup from './useSetup';
import {open} from './setup-model';

export default function SetupTitle({projectId}) {
 const {data}=useSetup(projectId);
 if (data?.facts?.localTrialUrl && open(data).length===0) return <span>Ready to try chat</span>;
 return data&&data.done===data.applicableTotal?<span data-setup-state="ready">All set</span>:<span data-setup-state="needs-you">Nearly ready</span>;
}
