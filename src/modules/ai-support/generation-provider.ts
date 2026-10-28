import {knowledgeAnswer} from '../knowledge/model-door';
import {tracedTools} from './tool-trace';
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
  let chunkIndex = 0;
  let usageResult: unknown = null;
  const context = await replyContext(env, row.project_id, row.conversation_id, row.kind === 'suggestions' ? 'agent' : 'contact', row.id);
  if (row.kind === 'reply') context.tools.push(handoffTool(env,row,effects));
  context.tools = tracedTools(env, attemptId, context.tools);
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
      if (row.kind === 'reply' && event.type === 'message_delta' && typeof event.content === 'string' && !event.thinking) {
        await effects.emit(env, row, {
          // Customer-visible text waits for whole-answer admission; a restricted
          // copied run can span provider deltas. Operators retain live progress.
          type: 'chunk', operatorOnly: true,
          payload: { localId: `generation:${row.id}`, chunk: await knowledgeAnswer(env,row.project_id,row.id,event.content), index: chunkIndex++, agent: context.agent },
        });
      }
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
  return { result: row.kind === 'reply' ? {...result, citations: context.selectedCitations} : result, usage: usageResult };
}
