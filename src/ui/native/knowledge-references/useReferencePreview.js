import {useEffect,useRef,useState} from 'react';
import {nativeRequest} from '../transport';

/** Only a response for the editor's current text and audience may update its cards. */
export default function useReferencePreview({projectId,conversationId,content,cc,bcc,audienceRevision,enabled,onPreview}) {
    const [state,setState] = useState({key:null,pending:false,error:''});
    const inputKey = JSON.stringify([projectId,conversationId,content,cc,bcc,audienceRevision,enabled]);
    const current = useRef(null);
    current.current = {key:inputKey,onPreview};
    useEffect(() => {
        const controller = new AbortController();
        const isCurrent = () => !controller.signal.aborted && current.current.key === inputKey;
        if (!enabled || !content?.trim()) {
            setState({key:inputKey,pending:false,error:''});
            return () => controller.abort();
        }
        setState({key:inputKey,pending:true,error:''});
        const timer = setTimeout(async () => {
            try {
                const result = await nativeRequest(`/api/knowledge/${encodeURIComponent(projectId)}/references/preview`,{
                    method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
                    body:JSON.stringify({conversationId,content,cc,bcc}),
                });
                if (!isCurrent()) return;
                current.current.onPreview(result);
                setState({key:inputKey,pending:false,error:''});
            } catch (failure) {
                if (isCurrent()) setState({key:inputKey,pending:false,error:failure.message});
            }
        },300);
        return () => {clearTimeout(timer);controller.abort();};
    },[inputKey]);
    const pending = Boolean(enabled && content?.trim() && (state.key !== inputKey || state.pending));
    return {pending,error:state.key === inputKey ? state.error : ''};
}
