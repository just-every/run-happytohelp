import {tracedTools} from './tool-trace';
import {tracedTools as executionTools} from './execution-tools';
import {handoffTool} from './handoff';
import type { Env } from '../../platform/env';
import type { Generation } from './repository';
import { replyContext } from './context';
import { saveEvent } from './repository';
import type { GenerationEffects } from './generation-effects';
// @ts-ignore Retained Ensemble request-scoped runtime.
import { withWorkerRuntime } from './vendor/ensemble/worker-runtime.js';
// @ts-ignore Retained orchestration.
import { runStream, TASKS } from './llm/orchestrator.js';
// @ts-ignore Retained customer prompt.
import { customerReplyMessages } from './replies/prompt.js';
// @ts-ignore Retained two-pass assistance.
import { generateSuggestions, generateReply } from './assist/prompt.js';
import { demoEffect } from '../../vendor/base/modules/demo/index.mjs';
import { demoGeneration } from '../../demo/ai';

export async function executeGenerationProvider(
  env: Env,
  row: Generation,
  attemptId: string,
  abort: AbortController,
  checkCurrent: () => Promise<void>,
  effects: GenerationEffects,
  onProviderStarted: () => void,
) {
  let usageResult: unknown = null;
  const context = await replyContext(env, row.project_id, row.conversation_id, row.kind === 'suggestions' ? 'agent' : 'contact', row.id);
  if (row.kind === 'reply') context.tools.push(handoffTool(env,row,effects));
  context.tools=executionTools(env,row,tracedTools(env,attemptId,context.tools),checkCurrent);
  if (row.instruction) {
    Object.assign(context.assistPacket, { operator_guidance: { content: row.instruction, visibility: 'private-to-operators' } });
    context.packet.trigger.server_instructions.push({ visibility: 'server-trigger', content: row.instruction });
  }

  const trace = {
    async onEvent(event: any) {
      // Ensemble yields agent_start before entering provider.createResponseStream.
      // Persist its identity before allowing that generator to advance to dispatch.
      if (event.type === 'agent_start') onProviderStarted();
      await saveEvent(env, attemptId, event);
      await checkCurrent();
      // An unoffered call invalidates this customer answer. Letting the model
      // continue after a tool lookup failure can publish a false success claim.
      if (row.kind === 'reply' && event.type === 'tool_start') {
        const offered = context.tools.find(tool => tool.definition.function.name === event.tool_call?.function?.name);
        if (!offered) {
          const error = new Error('Unoffered customer tool denied');
          abort.abort(error);
          throw error;
        }
      }
      // Customer text is published only by durable message admission. Model
      // deltas can contain a source revoked mid-turn; sending them here would
      // bypass the final recipient/source and clean-handoff checks.
    },
    async onUsage(usage: unknown) {
      usageResult = usage;
      await env.DB.prepare('UPDATE ai_generations SET output_json=? WHERE id=?').bind(JSON.stringify({ usage }), row.id).run();
      await effects.emit(env, row, { type: 'generation.usage', operatorOnly: true, generationId: row.id, usage });
    },
  };

  if (row.kind === 'suggestions') {
    const actor = JSON.parse(row.actor_json);
    const human = await env.DB.prepare('SELECT id,name FROM users WHERE id=?').bind(actor.id).first();
    Object.assign(context.assistPacket.drafting_identity, { human });
  }
  const clientOptions = JSON.parse(row.options_json || '{}');
  if (clientOptions.message) Object.assign(context.assistPacket, { draft: { content: clientOptions.message } });
  const options = {
    model: row.model,
    agent_instructions: row.instruction,
    abortSignal: abort.signal,
    maxToolCalls: 8,
    maxToolCallRoundsPerTurn: 4,
    trace,
  };
  const runtime = {
    apiKey: env.OPENAI_API_KEY,
    files: env.FILES,
    scope: `projects/${row.project_id}/generations/${row.id}`,
    settings: env,
  };
  // A demo copy answers from demo/ai.ts instead of a model provider: no key, no paid call.
  const result = await demoEffect(() => withWorkerRuntime(runtime, () => {
    if (row.kind === 'suggestions') {
      const request = {
        project_id: row.project_id,
        assist: { packet: context.assistPacket, policies: context.policies, evidenceIds: context.evidenceIds },
        tools: context.tools,
        options,
      };
      return clientOptions.tool
        ? generateReply(request, null, clientOptions.tool)
        : generateSuggestions(request);
    }
    return runStream({
      project_id: row.project_id,
      task: TASKS.USER_REPLY,
      messages: customerReplyMessages({ replies: { packet: context.packet, policies: context.policies } }),
      tools: context.tools,
      options,
      trace,
    });
  }), () => demoGeneration(env, row, clientOptions));
  if(row.kind==='reply'&&context.followupReview.required){
    await checkCurrent();
    await executionTools(env,row,[handoffTool(env,row,effects)],checkCurrent)[0].function('human');
  }
  return { result: row.kind === 'reply' ? {...result, requiresHumanReview:context.followupReview.required,citations: context.selectedCitations} : result, usage: usageResult };
}
