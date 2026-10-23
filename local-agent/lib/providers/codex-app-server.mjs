import { AGENT_VERSION } from '../version.mjs';
import { JsonlRpc } from '../jsonl-rpc.mjs';
import { ConnectorError } from '../errors.mjs';
import { runtimeFailure } from '../util.mjs';
import { codexProviderError } from './codex-error.mjs';
import { providerFailureSummary } from '../provider-error.mjs';
import { AGENT_OUTPUT_SCHEMA } from '../result.mjs';

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlArray(values) {
  return `[${values.map((value) => tomlString(value)).join(', ')}]`;
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.delta === 'string') return value.delta;
  if (Array.isArray(value)) return value.map(extractText).join('');
  if (Array.isArray(value.content)) return value.content.map(extractText).join('');
  return '';
}


function appServerArgs(browserMcp) {
  const args = ['app-server'];
  if (!browserMcp) return args;
  args.push(
    '-c', `mcp_servers.h2h_browser.command=${tomlString(browserMcp.command)}`,
    '-c', `mcp_servers.h2h_browser.args=${tomlArray(browserMcp.args)}`,
  );
  return args;
}

export async function runCodex({ prompt, identity, onIdentity, onProgress, signal, browserMcp, workingDirectory, model }) {
  const rpc = new JsonlRpc('codex', appServerArgs(browserMcp));
  let threadId = identity?.providerThreadId || null;
  let providerSessionId = identity?.providerSessionId || null;
  let turnId = null;
  let completedText = '';
  let deltaText = '';
  let turnStatus = null;
  let interrupted = false;
  let providerError = null;
  let terminal = false;
  const earlyNotifications = [];
  let complete;
  const turnDone = new Promise((resolve) => { complete = resolve; });
  const completeFailedTurn = (error) => {
    if (terminal) return;
    terminal = true;
    turnStatus = 'failed';
    complete(error);
  };
  rpc.child.once('close', () => completeFailedTurn(new Error('Codex app-server exited before completing the turn.')));

  const notification = (message) => {
    // Raw accounting is observable on the native protocol by the local caller;
    // response contents never become progress, result evidence or buffered text.
    if (message.method === 'rawResponse/completed' || message.method === 'rawResponseItem/completed') return;
    const params = message.params || {};
    if (!turnId) { earlyNotifications.push(message); return; }
    if (params.threadId !== threadId && params.turn?.threadId !== threadId) return;
    const eventTurnId = params.turnId || params.turn?.id;
    if (eventTurnId && eventTurnId !== turnId) return;
    if (message.method === 'error' && !params.willRetry && !terminal) {
      providerError = codexProviderError(params.error) || providerError;
    }
    if (message.method === 'item/agentMessage/delta') {
      deltaText += extractText(params);
      if (deltaText.length % 4_000 < 600) onProgress?.('Codex is working.');
    }
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage') {
      const text = extractText(params.item);
      if (text) completedText = text;
    }
    if (message.method === 'turn/completed' && (!threadId || params.threadId === threadId || params.turn?.threadId === threadId)) {
      if (terminal) return;
      terminal = true;
      turnStatus = params.turn?.status || 'completed';
      providerError = codexProviderError(params.turn?.error) || providerError;
      complete();
    }
  };
  const unsubscribe = rpc.onNotification(notification);

  const interrupt = async () => {
    if (interrupted) return;
    interrupted = true;
    if (threadId && turnId) {
      try {
        await rpc.request('turn/interrupt', { threadId, turnId }, 10_000);
      } catch {
        // The process may have already completed; terminal cancellation is still reported upstream.
      }
    }
  };
  const abort = () => {
    void interrupt();
    // A deadline can arrive before turn/start returns its ID. End only this
    // owned provider process; the server still records an unconfirmed outcome.
    if (signal?.reason?.code === 'JOB_TERMINAL') { rpc.child.kill('SIGTERM'); void rpc.close(); }
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'happytohelp-local-agent', title: 'HappyToHelp local agent', version: AGENT_VERSION },
      capabilities: { experimentalApi: true },
    });
    rpc.notify('initialized', {});
    const response = threadId
      ? await rpc.request('thread/resume', { threadId })
      : await rpc.request('thread/start', {
        cwd: workingDirectory,
        experimentalRawEvents: true,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        ...(model ? { model } : {}),
        serviceName: 'happytohelp-local-agent',
      });
    const thread = response?.thread;
    if (!thread?.id) runtimeFailure('Codex', 'app-server did not return a thread identity.');
    threadId = thread.id;
    providerSessionId = thread.sessionId || thread.id;
    await onIdentity?.({
      provider: 'codex',
      providerThreadId: thread.id,
      providerSessionId,
    });
    const turn = await rpc.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: workingDirectory,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      ...(model ? { model } : {}),
      outputSchema: AGENT_OUTPUT_SCHEMA,
    });
    turnId = turn?.turn?.id;
    if (!turnId) runtimeFailure('Codex', 'app-server did not return a turn identity.');
    for (const message of earlyNotifications.splice(0)) notification(message);
    onProgress?.('Codex session started.');

    const finished = await Promise.race([
      turnDone,
      new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true })),
    ]);
    if (finished instanceof Error) throw finished;
    if (signal?.aborted) {
      await interrupt();
      const interruptedTurn = await Promise.race([turnDone, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (interruptedTurn instanceof Error) throw interruptedTurn;
    }
    if (turnStatus && turnStatus !== 'completed' && turnStatus !== 'interrupted') {
      runtimeFailure('Codex', `turn completed with status ${turnStatus}.`);
    }
    return {
      cancelled: Boolean(signal?.aborted || interrupted || turnStatus === 'interrupted'),
      sessionId: providerSessionId,
      providerThreadId: threadId,
      rawText: completedText || deltaText,
    };
  } catch (error) {
    providerError ||= error.provider_error;
    if (!providerError && !turnId) {
      // A failed turn/start can close before its response establishes a turn ID.
      // Preserve the last native, non-retrying error from this exact thread.
      for (const message of earlyNotifications) {
        if (message.method === 'error' && message.params?.threadId === threadId && !message.params.willRetry) {
          providerError = codexProviderError(message.params.error) || providerError;
        }
      }
    }
    if (providerError) throw new ConnectorError(providerFailureSummary(providerError), { code: 'RUNTIME_FAILED', providerError });
    // Arbitrary app-server errors may echo the assignment or credentials.
    runtimeFailure('Codex', 'The local runtime failed before returning a usable result. Inspect the local runtime privately.');
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abort);
    await rpc.close();
  }
}
