import triage from '../../helpers/ai/triage-network.mjs'
import slack from '../../fixtures/sla-slack-edge.mjs'
// The only fakes are the paid model and notification-provider network edges.
export default request=>new URL(request.url).hostname==='api.openai.com'?triage(request):slack(request)
