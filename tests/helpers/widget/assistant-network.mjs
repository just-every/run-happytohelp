import {openaiStream} from '../openai-stream.mjs';
// Only the paid model boundary is faked. The widget, assignment and admitted reply are real.
export default async request=>new URL(request.url).hostname==='api.openai.com'
 ? openaiStream('I am the AI assistant. I can help with your checkout question.')
 : new Response('Unexpected outbound request',{status:599});
