import { LocalAgentApi } from './api.mjs';
import { runtimeCapabilities, browserMcpForRuntime } from './capabilities.mjs';
import { normalizeConfig, syncLegacyActive, writeConfig } from './config.mjs';
import { ApiError, ConnectorError, userMessage } from './errors.mjs';
import { validateWorkspaceFolders } from './folders.mjs';
import { localScreenshot } from './attachments.mjs';
import { assignmentForSession, assignmentGuidance, buildDelegationPrompt } from './prompt.mjs';
import { retainDeniedResultReceipt } from './receipts.mjs';
import { failureResult, validateAgentOutput } from './result.mjs';
import { runProvider } from './providers/index.mjs';
import { boundedText, parseLastJson, uuid } from './util.mjs';

const POLL_MS = 5_000;
const MONITOR_MS = 2_000;

function activeJobs(config) {
  normalizeConfig(config);
  return config.activeJobs;
}

function activeFor(config, jobId) {
  const jobs = activeJobs(config);
  if (jobId) {
    const active = jobs[jobId];
    if (!active) throw new ConnectorError(`No active job matches ${jobId}.`, { code: 'NO_ACTIVE_JOB' });
    return active;
  }
  const values = Object.values(jobs);
  if (values.length === 1) return values[0];
  if (!values.length) throw new ConnectorError('There is no active job.', { code: 'NO_ACTIVE_JOB' });
  throw new ConnectorError('Specify job_id because multiple jobs are active.', { code: 'JOB_ID_REQUIRED' });
}

function addActive(config, active) {
  activeJobs(config)[active.jobId] = active;
  syncLegacyActive(config);
  return active;
}

function removeActive(config, active) {
  if (active?.jobId) delete activeJobs(config)[active.jobId];
  syncLegacyActive(config);
}

function activeJobIds(config) {
  return Object.keys(activeJobs(config));
}

function scopedJobState(response, jobId) {
  const jobs = response?.active_jobs ?? response?.activeJobs;
  if (Array.isArray(jobs)) {
    return jobs.find((job) => job && (job.id === jobId || job.job_id === jobId)) || null;
  }
  if (jobs && typeof jobs === 'object') return jobs[jobId] || null;
  return {
    cancel_requested: response?.cancel_requested ?? response?.cancelRequested,
    input_messages: response?.input_messages ?? response?.inputMessages,
  };
}

function reconcileTerminalJobs(config, response) {
  const jobs = response?.active_jobs ?? response?.activeJobs;
  if (!Array.isArray(jobs) && !(jobs && typeof jobs === 'object')) return [];
  const reported = new Set(Array.isArray(jobs)
    ? jobs.filter((job) => job && typeof job.id === 'string').map((job) => job.id)
    : Object.keys(jobs));
  const terminal = [];
  for (const jobId of activeJobIds(config)) {
    if (reported.has(jobId)) continue;
    const active = activeJobs(config)[jobId];
    if (active.pendingResult) {
      // The server omits both a membership-loss cancellation and a completed
      // result whose response was lost. Keep the durable result/event so its
      // idempotent retry can discover which outcome actually applied.
      active.phase = 'result_receipt_recovery';
      continue;
    }
    terminal.push(active);
  }
  for (const active of terminal) removeActive(config, active);
  return terminal;
}

function cancelRequested(response) {
  return Boolean(response?.cancel_requested ?? response?.cancelRequested);
}

function inputMessages(response) {
  return Array.isArray(response?.input_messages) ? response.input_messages
    : (Array.isArray(response?.inputMessages) ? response.inputMessages : []);
}

function authorizationFailure(error) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

async function markRevoked(config, save) {
  for (const active of Object.values(activeJobs(config))) {
    active.phase = 'revoked_unknown';
    active.revokedAt = new Date().toISOString();
  }
  config.revokedAt = new Date().toISOString();
  await save();
}

function assertClaim(job) {
  if (!job || typeof job !== 'object') return null;
  if (typeof job.id !== 'string' || typeof job.run_id !== 'string' || typeof job.mode !== 'string') {
    throw new ConnectorError('Claim response omitted a job id, run id, or mode.', { code: 'INVALID_CLAIM' });
  }
  if (!['investigate', 'resolve', 'resolve_reply'].includes(job.mode) || typeof job.instructions !== 'string') {
    throw new ConnectorError('Claim response contains an unsupported delegation job.', { code: 'INVALID_CLAIM' });
  }
  return job;
}

function newActive(job, claimId) {
  return {
    job,
    jobId: job.id,
    runId: job.run_id,
    claimId,
    phase: 'claimed',
    providerIdentity: null,
    pendingInput: [],
    seenInputIds: [],
    pendingResult: null,
    progressSequence: 0,
    lastProgressAt: 0,
  };
}

export async function refreshCapabilities(config, {
  forceBrowserProbe = false,
  forceCodexLoginCheck = false,
  runtimeCapabilitiesFn = runtimeCapabilities,
} = {}) {
  const report = await runtimeCapabilitiesFn(config, { forceBrowserProbe, forceCodexLoginCheck });
  config.browserHealth = report.details.browser;
  return report;
}

export async function heartbeat(config, api, {
  forceBrowserProbe = false,
  forceCodexLoginCheck = false,
  workerMode,
  runtimeCapabilitiesFn = runtimeCapabilities,
} = {}) {
  const report = await refreshCapabilities(config, { forceBrowserProbe, forceCodexLoginCheck, runtimeCapabilitiesFn });
  const workerReady = workerMode === 'mcp' || (workerMode === 'direct' && report.details.directRunnerAvailable);
  const response = await api.heartbeat({
    capabilities: report.capabilities,
    ...(activeJobIds(config).length ? { active_job_ids: activeJobIds(config) } : {}),
    ...(workerMode === null ? { worker_mode: null } : {}),
    ...(workerReady ? { worker_mode: workerMode } : {}),
  });
  return { response, report };
}

export function unseenInputs(config, response, active = null) {
  const state = active ? scopedJobState(response, active.jobId) : response;
  const known = new Set(active?.seenInputIds || config.seenInputIds || []);
  return inputMessages(state).filter((message) => message && typeof message.id === 'string'
    && typeof message.message === 'string' && !known.has(message.id));
}

export function markInputsSeen(config, messages, active = null) {
  if (!messages.length) return;
  const known = new Set(active?.seenInputIds || config.seenInputIds || []);
  const ids = [...known, ...messages.map((message) => message.id)].slice(-256);
  if (active) active.seenInputIds = ids;
  else config.seenInputIds = ids;
}

function stageInputs(active, received) {
  const byId = new Map((active.pendingInput || []).filter((message) => message?.id).map((message) => [message.id, message]));
  for (const message of received) byId.set(message.id, message);
  active.pendingInput = [...byId.values()].slice(-64);
  return active.pendingInput;
}

function mcpRecovery(config, instanceId, active = null) {
  active ||= activeFor(config);
  if (!active) return null;
  if (active.mcpInstanceId === instanceId && active.phase === 'mcp_started') return null;
  return {
    required: true,
    reason: 'This assignment was previously exposed to a different MCP host session. Its tool activity may be unknown.',
    next_step: 'Do not repeat an action. Submit h2h_result with status=needs_input, verified=false, and a question explaining the interrupted session so the operator can review it in HappyToHelp. Call h2h_input for their new recovery instruction, then call h2h_recover with that input ID.',
  };
}

export async function claimNext(config, api, persist) {
  const claimId = config.pendingClaim?.claimId || uuid();
  if (!config.pendingClaim) {
    config.pendingClaim = { claimId, createdAt: new Date().toISOString() };
    await persist?.();
  }
  const response = await api.claim({ claim_id: claimId });
  const job = assertClaim(response);
  config.pendingClaim = null;
  if (job && !activeJobs(config)[job.id]) addActive(config, newActive(job, claimId));
  await persist?.();
  return job;
}

export async function postProgress(config, api, message, { force = false, active: selectedActive = null } = {}) {
  const active = selectedActive || activeFor(config);
  if (!active?.jobId || !active?.runId) return;
  const now = Date.now();
  if (!force && now - (active.lastProgressAt || 0) < 750) return;
  active.lastProgressAt = now;
  active.progressSequence = (active.progressSequence || 0) + 1;
  const eventId = `${active.runId}:progress:${active.progressSequence}`;
  await api.progress(active.jobId, {
    run_id: active.runId,
    event_id: eventId,
    message: boundedText(message),
    ...(active.providerIdentity?.providerSessionId ? { session_id: active.providerIdentity.providerSessionId } : {}),
  });
}

export async function submitResult(config, api, status, result, sessionId, persist, selectedActive = null) {
  const active = selectedActive || activeFor(config);
  if (!active?.jobId || !active?.runId) throw new ConnectorError('There is no active job to submit.', { code: 'NO_ACTIVE_JOB' });
  if (!['completed', 'needs_input', 'failed', 'cancelled'].includes(status)) {
    throw new ConnectorError(`Unsupported terminal status: ${status}`, { code: 'INVALID_RESULT' });
  }
  const pending = active.pendingResult || {
    eventId: `${active.runId}:result:${uuid()}`,
    status,
    result,
    sessionId: sessionId || active.providerIdentity?.providerSessionId || null,
  };
  if (pending.status !== status) {
    throw new ConnectorError('An active job already has a different pending result.', { code: 'RESULT_CONFLICT' });
  }
  active.pendingResult = pending;
  await persist?.();
  let serverResponse;
  try {
    serverResponse = await api.result(active.jobId, {
      run_id: active.runId,
      event_id: pending.eventId,
      status: pending.status,
      result: pending.result,
      ...(pending.sessionId ? { session_id: pending.sessionId } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && active.phase === 'result_receipt_recovery') {
      retainDeniedResultReceipt(config, active);
      removeActive(config, active);
      await persist?.();
      return { status: 'access_denied_terminal', terminal: true };
    }
    throw error;
  }
  const serverJob = serverResponse?.job || serverResponse || {};
  const appliedStatus = serverJob.status || status;
  const deliveryState = serverJob.delivery_state || serverJob.deliveryState || null;
  if (appliedStatus === 'running' && deliveryState === 'delivering') {
    active.phase = 'delivery_pending';
    active.serverStatus = appliedStatus;
    active.deliveryState = deliveryState;
    return { status: 'delivery_pending', pending: true, job: serverJob };
  }
  if (!['completed', 'needs_input', 'failed', 'cancelled'].includes(appliedStatus)) {
    throw new ConnectorError('HappyToHelp result response contains an invalid job status.', { code: 'INVALID_API_RESPONSE' });
  }
  active.pendingResult = null;
  if (appliedStatus === 'needs_input') {
    active.phase = 'needs_input';
    delete active.resumeInputIds;
    active.serverStatus = appliedStatus;
    active.operatorQuestion = serverJob.result?.question || serverJob.question || pending.result.question || null;
    const currentContext = serverJob.current_context || serverJob.currentContext || serverJob.context || null;
    if (currentContext) active.currentContext = currentContext;
    return { status: appliedStatus, job: serverJob };
  }
  config.lastRun = {
    jobId: active.jobId,
    runId: active.runId,
    status: appliedStatus,
    completedAt: new Date().toISOString(),
    sessionId: pending.sessionId,
  };
  removeActive(config, active);
  return { status: appliedStatus, job: serverJob };
}

function createProgressReporter(config, api, save, log, active) {
  let reporting = Promise.resolve();
  return (message) => {
    reporting = reporting.then(async () => {
      try {
        await postProgress(config, api, message, { active });
        await save();
      } catch (error) {
        log(`Progress could not be sent: ${userMessage(error)}`);
      }
    });
    return reporting;
  };
}

async function startCancellationMonitor(config, api, save, runtimeAbort, log, active, runtimeCapabilitiesFn, intervalMs = MONITOR_MS) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped || runtimeAbort.signal.aborted) return;
    try {
      const { response } = await heartbeat(config, api, { workerMode: 'direct', runtimeCapabilitiesFn });
      reconcileTerminalJobs(config, response);
      if (!activeJobs(config)[active.jobId]) {
        await save();
        runtimeAbort.abort(new ConnectorError('The server withdrew this assignment after workspace access changed.', { code: 'JOB_TERMINAL' }));
        return;
      }
      const state = scopedJobState(response, active.jobId);
      const received = unseenInputs(config, response, active);
      if (received.length) {
        stageInputs(active, received);
      }
      await save();
      if (cancelRequested(state)) runtimeAbort.abort(new Error('Cancellation requested by operator.'));
    } catch (error) {
      if (authorizationFailure(error)) {
        await markRevoked(config, save);
        runtimeAbort.abort(new ConnectorError('Device authorization was revoked by HappyToHelp.', { code: 'DEVICE_REVOKED' }));
        return;
      }
      log(`Heartbeat failed while work continues: ${userMessage(error)}`);
    }
    if (!stopped && !runtimeAbort.signal.aborted) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function execute(config, api, save, {
  active: selectedActive = null,
  input = [],
  signal,
  log = () => {},
  providerRunner = runProvider,
  runtimeCapabilitiesFn = runtimeCapabilities,
  monitorIntervalMs = MONITOR_MS,
} = {}) {
  const active = selectedActive || activeFor(config);
  if (!active?.job) throw new ConnectorError('No claimed job is available.', { code: 'NO_ACTIVE_JOB' });
  const mapping = await validateWorkspaceFolders(active.job.workspace_folders);
  active.workspaceFolders = mapping.folders;
  // Folder mappings are useful launch locations supplied by HappyToHelp. They
  // are not an access-control boundary: preserve any unavailable-path details
  // for the agent, then let the provider use its host permissions and task
  // scope to choose the actual location.
  active.job.workspace_folders = mapping.folders;
  active.job.workspace_folder_diagnostics = mapping.problems;
  if (active.pendingResult) {
    await submitResult(config, api, active.pendingResult.status, active.pendingResult.result, active.pendingResult.sessionId, save, active);
    await save();
    return;
  }
  if (active.phase === 'running' || active.phase === 'dispatched') {
    active.phase = 'interrupted_unknown';
    await save();
    throw new ConnectorError(`Job ${active.jobId} was already dispatched before this process started. It will not be replayed automatically; cancel or inspect it from the dashboard.`, {
      code: 'UNKNOWN_ACTIVE_RUN',
    });
  }

  if (config.provider === 'claude' && !active.providerIdentity) {
    active.providerIdentity = { provider: 'claude', providerSessionId: uuid() };
    await save();
  }
  if (input.length) {
    const consumedInputIds = new Set(input.map((message) => message.id));
    markInputsSeen(config, input, active);
    active.pendingInput = (active.pendingInput || []).filter((message) => !consumedInputIds.has(message?.id));
    active.resumeInputIds = [...consumedInputIds];
  }
  active.phase = 'dispatched';
  active.dispatchStartedAt = new Date().toISOString();
  await save();
  const runtimeAbort = new AbortController();
  const bridgeAbort = () => runtimeAbort.abort(signal?.reason || new Error('Connector stopped.'));
  if (signal?.aborted) bridgeAbort();
  signal?.addEventListener('abort', bridgeAbort, { once: true });
  const stopMonitor = await startCancellationMonitor(config, api, save, runtimeAbort, log, active, runtimeCapabilitiesFn, monitorIntervalMs);
  const report = createProgressReporter(config, api, save, log, active);
  const expiresAt = active.job.context?.authority?.expires_at;
  const expire = () => runtimeAbort.abort(new ConnectorError('Task time authority expired; the local outcome is unconfirmed. Review it before authorizing another task.', { code: 'JOB_TERMINAL' }));
  const deadline = Number.isSafeInteger(expiresAt) ? setTimeout(expire, Math.max(0, expiresAt - Date.now())) : null;
  if (Number.isSafeInteger(expiresAt) && expiresAt <= Date.now()) expire();
  try {
    if (runtimeAbort.signal.aborted) throw runtimeAbort.signal.reason;
    await report(`${config.provider} is starting the delegated session.`);
    const providerResult = await providerRunner(config.provider, {
      prompt: buildDelegationPrompt(active.job, {
        resumeInput: input.length ? input.map((item) => item.message).join('\n\n') : undefined,
        currentContext: active.currentContext,
      }),
      identity: active.providerIdentity,
      workingDirectory: mapping.folders[0] || config.workingDirectory,
      browserMcp: config.browserHealth?.healthy ? browserMcpForRuntime(config.browserMcp) : null,
      model: config.model || undefined,
      signal: runtimeAbort.signal,
      onProgress: report,
      onIdentity: async (identity) => {
        active.providerIdentity = { ...active.providerIdentity, ...identity };
        await save();
      },
    });
    if (providerResult.cancelled || runtimeAbort.signal.aborted) {
      if (runtimeAbort.signal.reason?.code === 'DEVICE_REVOKED') {
        await markRevoked(config, save);
        throw runtimeAbort.signal.reason;
      }
      if (runtimeAbort.signal.reason?.code !== 'JOB_TERMINAL') {
        await submitResult(config, api, 'cancelled', failureResult('Delegated local runtime was cancelled.'), providerResult.sessionId, save, active);
      }
      await save();
      return;
    }
    const parsed = parseLastJson(providerResult.rawText);
    const output = validateAgentOutput(parsed, { mode: active.job.mode });
    const submitted = await submitResult(config, api, output.status, output.result, providerResult.sessionId, save, active);
    await save();
    if (submitted.pending || submitted.terminal) return;
    await report(submitted.status === 'completed' ? 'Delegated work completed and was verified.' : 'Delegated work needs operator input.');
  } catch (error) {
    if (active.pendingResult) {
      await save();
    } else if (runtimeAbort.signal.reason?.code === 'DEVICE_REVOKED') {
      await markRevoked(config, save);
    } else if (runtimeAbort.signal.reason?.code === 'JOB_TERMINAL') {
      // The server already withdrew this job (for example after workspace access changed); it never learns the local outcome.
    } else if (runtimeAbort.signal.aborted) {
      await submitResult(config, api, 'cancelled', failureResult('Delegated local runtime was cancelled.'), active.providerIdentity?.providerSessionId, save, active);
    } else {
      await submitResult(config, api, 'failed', failureResult(userMessage(error), error.provider_error), active.providerIdentity?.providerSessionId, save, active);
    }
    await save();
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    stopMonitor();
    signal?.removeEventListener('abort', bridgeAbort);
  }
}

export class LocalRunner {
  constructor(config, {
    configPath,
    log = () => {},
    providerRunner = runProvider,
    runtimeCapabilitiesFn = runtimeCapabilities,
    monitorIntervalMs = MONITOR_MS,
  } = {}) {
    this.config = config;
    this.configPath = configPath;
    this.log = log;
    this.api = new LocalAgentApi(config);
    this.providerRunner = providerRunner;
    this.runtimeCapabilitiesFn = runtimeCapabilitiesFn;
    this.monitorIntervalMs = monitorIntervalMs;
    this.mcpInstanceId = uuid();
    this.mcpWorkerActive = false;
    this.runningJobs = new Map();
    this.mutationTail = Promise.resolve();
  }

  async save() { await writeConfig(this.config, this.configPath); }

  async status({ probeBrowser = true } = {}) {
    const report = await refreshCapabilities(this.config, {
      forceBrowserProbe: probeBrowser,
      forceCodexLoginCheck: true,
      runtimeCapabilitiesFn: this.runtimeCapabilitiesFn,
    });
    await this.save();
    return {
      device: this.config.device,
      provider: this.config.provider,
      model: this.config.model || null,
      server: this.config.server,
      capabilities: report.capabilities,
      directRunnerAvailable: report.details.directRunnerAvailable,
      directRunnerReason: report.details.directRunnerReason || null,
      browser: report.details.browser,
      active: this.config.active ? {
        jobId: this.config.active.jobId,
        runId: this.config.active.runId,
        phase: this.config.active.phase,
        sessionId: this.config.active.providerIdentity?.providerSessionId || null,
      } : null,
      activeJobs: Object.values(activeJobs(this.config)).map((active) => ({
        jobId: active.jobId,
        runId: active.runId,
        phase: active.phase,
        sessionId: active.providerIdentity?.providerSessionId || null,
      })),
    };
  }

  async mcpActivity() {
    const result = await heartbeat(this.config, this.api, { workerMode: 'mcp', runtimeCapabilitiesFn: this.runtimeCapabilitiesFn });
    const terminalJobs = reconcileTerminalJobs(this.config, result.response);
    this.mcpWorkerActive = true;
    await this.save();
    return { ...result, terminalJobs };
  }

  async workerStopped() {
    if (this.config.revokedAt || Object.values(activeJobs(this.config)).some((active) => active.phase === 'revoked_unknown')) return;
    try {
      await heartbeat(this.config, this.api, { workerMode: null, runtimeCapabilitiesFn: this.runtimeCapabilitiesFn });
      await this.save();
    } catch {
      // A stopped local process must not hide the real shutdown or revocation error.
    }
  }

  async mcpStopped() {
    if (this.mcpWorkerActive) await this.workerStopped();
  }

  async claim() {
    const { response } = await this.mcpActivity();
    if (cancelRequested(response)) throw new ConnectorError('Device is marked for cancellation.', { code: 'DEVICE_CANCELLED' });
    const job = await claimNext(this.config, this.api, () => this.save());
    if (job) {
      const active = activeFor(this.config, job.id);
      if (!active.mcpInstanceId) {
        const mapping = await validateWorkspaceFolders(job.workspace_folders);
        active.workspaceFolders = mapping.folders;
        active.job.workspace_folders = mapping.folders;
        active.job.workspace_folder_diagnostics = mapping.problems;
        active.phase = 'mcp_started';
        active.mcpInstanceId = this.mcpInstanceId;
        active.mcpStartedAt = new Date().toISOString();
      }
      await this.save();
      return assignmentForSession(active.job, {
        recovery: mcpRecovery(this.config, this.mcpInstanceId, active),
      });
    }
    await this.save();
    return null;
  }

  async context({ jobId, fresh = false } = {}) {
    const active = activeFor(this.config, jobId);
    const activity = await this.mcpActivity();
    if (activity.terminalJobs.some((job) => job.jobId === active.jobId)) {
      throw new ConnectorError('The server withdrew this assignment. Do not continue or retry it.', { code: 'JOB_TERMINAL' });
    }
    if (fresh) {
      const snapshot = await this.api.context(active.jobId, active.runId);
      active.currentContext = snapshot?.context || snapshot;
      await this.save();
    }
    return {
      job_id: active.jobId,
      run_id: active.runId,
      context: active.currentContext || active.job.context || {},
      agent_guidance: {
        ...assignmentGuidance(active.job),
        ...(mcpRecovery(this.config, this.mcpInstanceId, active) ? { recovery: mcpRecovery(this.config, this.mcpInstanceId, active) } : {}),
      },
    };
  }

  async progress(message, jobId) {
    const active = activeFor(this.config, jobId);
    const activity = await this.mcpActivity();
    if (activity.terminalJobs.some((job) => job.jobId === active.jobId)) {
      throw new ConnectorError('The server withdrew this assignment. Do not continue or retry it.', { code: 'JOB_TERMINAL' });
    }
    await postProgress(this.config, this.api, message, { force: true, active });
    await this.save();
    return { accepted: true };
  }

  async result(status, result, sessionId, jobId) {
    const active = activeFor(this.config, jobId);
    const activity = await this.mcpActivity();
    if (activity.terminalJobs.some((job) => job.jobId === active.jobId)) {
      throw new ConnectorError('The server withdrew this assignment. Do not continue or retry it.', { code: 'JOB_TERMINAL' });
    }
    if (status === 'completed' || status === 'needs_input') {
      const validated = validateAgentOutput({ status, ...result });
      const submitted = await submitResult(this.config, this.api, validated.status, validated.result, sessionId, () => this.save(), active);
      await this.save();
      return { accepted: true, status: submitted.status, question: active.operatorQuestion || null };
    } else if (status === 'failed' || status === 'cancelled') {
      const submitted = await submitResult(this.config, this.api, status, failureResult(result?.summary || `Delegation ${status}.`), sessionId, () => this.save(), active);
      await this.save();
      return { accepted: true, status: submitted.status, question: active.operatorQuestion || null };
    } else {
      throw new ConnectorError('Result status must be completed, needs_input, failed, or cancelled.', { code: 'INVALID_RESULT' });
    }
  }

  async upload(filePath, jobId) {
    const active = activeFor(this.config, jobId);
    const activity = await this.mcpActivity();
    if (activity.terminalJobs.some((job) => job.jobId === active.jobId)) {
      throw new ConnectorError('The server withdrew this assignment. Do not upload or retry it.', { code: 'JOB_TERMINAL' });
    }
    const state = scopedJobState(activity.response, active.jobId);
    if (cancelRequested(state)) {
      throw new ConnectorError('Cancellation was requested for this assignment. Do not upload a screenshot.', { code: 'JOB_CANCELLED' });
    }
    const screenshot = await localScreenshot(filePath);
    const attachment = await this.api.upload(active.jobId, active.runId, screenshot);
    if (!attachment || typeof attachment.id !== 'string') {
      throw new ConnectorError('HappyToHelp upload response omitted the attachment ID.', { code: 'INVALID_API_RESPONSE' });
    }
    return {
      job_id: active.jobId,
      attachment: Object.fromEntries(['id', 'url', 'preview_url', 'aggregate_type', 'filename_original', 'size']
        .map((key) => [key, attachment[key]])),
    };
  }

  async input(jobId) {
    const active = activeFor(this.config, jobId);
    const { response, terminalJobs } = await this.mcpActivity();
    if (terminalJobs.some((job) => job.jobId === active.jobId)) {
      await this.save();
      return { cancelled: true, terminal: true, inputMessages: [] };
    }
    const state = scopedJobState(response, active.jobId);
    const messages = unseenInputs(this.config, response, active);
    markInputsSeen(this.config, messages, active);
    if (messages.length && mcpRecovery(this.config, this.mcpInstanceId, active)) {
      stageInputs(active, messages);
    }
    await this.save();
    return { cancelRequested: cancelRequested(state), inputMessages: messages };
  }

  async recover(inputId, jobId) {
    const active = activeFor(this.config, jobId);
    const activity = await this.mcpActivity();
    if (activity.terminalJobs.some((job) => job.jobId === active.jobId)) {
      throw new ConnectorError('The server withdrew this assignment. Do not continue or retry it.', { code: 'JOB_TERMINAL' });
    }
    if (!mcpRecovery(this.config, this.mcpInstanceId, active)) {
      return assignmentForSession(active.job);
    }
    const recoveryInput = (active.pendingInput || []).find((message) => message?.id === inputId);
    if (!recoveryInput) {
      throw new ConnectorError('Recovery requires the ID of a newly received operator input from h2h_input.', { code: 'RECOVERY_INPUT_REQUIRED' });
    }
    active.phase = 'mcp_started';
    active.mcpInstanceId = this.mcpInstanceId;
    active.mcpRecoveredAt = new Date().toISOString();
    active.mcpRecoveryInputId = recoveryInput.id;
    await this.save();
    return assignmentForSession(active.job, {
      recovery: {
        recovered: true,
        trusted_operator_recovery_input: recoveryInput.message,
        instruction: 'Treat this as additional operator instruction for the original assignment. Do not repeat an action unless it explicitly authorizes recovery.',
      },
    });
  }

  async waitForAssignment(waitMs = 0) {
    const maximum = Math.min(Math.max(Number(waitMs) || 0, 0), 25_000);
    const deadline = Date.now() + maximum;
    do {
      const job = await this.claim();
      if (job) return job;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, deadline - Date.now())));
    } while (Date.now() < deadline);
    return null;
  }

  async run({ once = false, signal, onReady = () => {} } = {}) {
    let announcedReady = false;
    const launch = (active, input = []) => {
      if (this.runningJobs.has(active.jobId)) return this.runningJobs.get(active.jobId).promise;
      const controller = new AbortController();
      const work = () => execute(this.config, this.api, () => this.save(), {
        active,
        input,
        signal: controller.signal,
        log: this.log,
        providerRunner: this.providerRunner,
        runtimeCapabilitiesFn: this.runtimeCapabilitiesFn,
        monitorIntervalMs: this.monitorIntervalMs,
      });
      const scheduled = active.job.mode === 'investigate'
        ? work()
        : this.mutationTail.then(work);
      if (active.job.mode !== 'investigate') this.mutationTail = scheduled.catch(() => undefined);
      const tracked = scheduled.finally(() => this.runningJobs.delete(active.jobId));
      this.runningJobs.set(active.jobId, { controller, promise: tracked });
      return tracked;
    };
    try {
      while (!signal?.aborted) {
        let heartbeatResult;
        try {
          heartbeatResult = await heartbeat(this.config, this.api, {
            workerMode: 'direct',
            forceCodexLoginCheck: !announcedReady,
            runtimeCapabilitiesFn: this.runtimeCapabilitiesFn,
          });
        } catch (error) {
          if (authorizationFailure(error) && activeJobIds(this.config).length) await markRevoked(this.config, () => this.save());
          throw error;
        }
        const { response, report } = heartbeatResult;
        await this.save();
        if (!announcedReady && report.details.directRunnerAvailable) {
          announcedReady = true;
          await onReady({ report, response });
        }
        const terminal = reconcileTerminalJobs(this.config, response);
        for (const active of terminal) {
          const running = this.runningJobs.get(active.jobId);
          running?.controller.abort(new ConnectorError('The server withdrew this assignment after workspace access changed.', { code: 'JOB_TERMINAL' }));
          this.log(`Job ${active.jobId} was withdrawn by the server and removed from the local queue.`);
        }
        const launchCandidates = [];
        let reconciledTerminalWork = false;
        for (const active of Object.values(activeJobs(this.config))) {
          if (this.runningJobs.has(active.jobId)) continue;
          if (active.pendingResult) {
            const pending = active.pendingResult;
            await submitResult(this.config, this.api, pending.status, pending.result, pending.sessionId, () => this.save(), active);
            reconciledTerminalWork = true;
            continue;
          }
          const state = scopedJobState(response, active.jobId);
          if (cancelRequested(state)) {
            await submitResult(this.config, this.api, 'cancelled', failureResult('Delegation was cancelled by the operator.'), undefined, () => this.save(), active);
            reconciledTerminalWork = true;
            continue;
          }
          launchCandidates.push({ active, state });
        }
        if (reconciledTerminalWork) await this.save();

        for (const { active } of launchCandidates) {
          if (!activeJobs(this.config)[active.jobId]) continue;
          if (active.phase === 'interrupted_unknown' || active.phase === 'running' || active.phase === 'dispatched' || active.phase === 'mcp_started') {
            throw new ConnectorError(`Job ${active.jobId} has an uncertain in-flight local runtime and will not be replayed. Cancel it from the dashboard before dispatching a replacement.`, {
              code: 'UNKNOWN_ACTIVE_RUN',
            });
          }
        }

        if (!launchCandidates.length && reconciledTerminalWork && once) return;
        if (!report.details.directRunnerAvailable) {
          throw new ConnectorError(report.details.directRunnerReason || `${this.config.provider} direct runner is unavailable.`, {
            code: 'RUNTIME_UNAVAILABLE',
          });
        }

        let started = null;
        for (const { active, state } of launchCandidates) {
          if (!activeJobs(this.config)[active.jobId]) continue;
          const inputs = unseenInputs(this.config, response, active);
          if (active.phase === 'needs_input') {
            const pendingInput = stageInputs(active, inputs);
            if (!pendingInput.length) continue;
            const snapshot = await this.api.context(active.jobId, active.runId);
            active.currentContext = snapshot?.context || snapshot;
            started = launch(active, pendingInput);
          } else if (active.phase === 'claimed') {
            started = launch(active);
          }
          if (once && started) {
            await started;
            return;
          }
        }

        if (!once) {
          // Claim repeatedly while the server grants capacity. A duplicate claim
          // response is an idempotency recovery, not another local execution.
          for (let attempts = 0; attempts < 8; attempts += 1) {
            const before = activeJobIds(this.config).length;
            const job = await claimNext(this.config, this.api, () => this.save());
            if (!job || activeJobIds(this.config).length === before) break;
            // A concurrent monitor may reconcile this claim while its save awaits.
            const active = activeJobs(this.config)[job.id];
            if (!active) continue;
            launch(active).catch((error) => this.log(`Job ${active.jobId} stopped: ${userMessage(error)}`));
          }
        } else if (!started) {
          const job = await claimNext(this.config, this.api, () => this.save());
          if (!job) return;
          await launch(activeFor(this.config, job.id));
          return;
        }
        await this.save();
        if (!signal?.aborted) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, POLL_MS);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
      }
    } finally {
      for (const { controller } of this.runningJobs.values()) controller.abort(new Error('Connector stopped.'));
      if (announcedReady) await this.workerStopped();
    }
  }
}
