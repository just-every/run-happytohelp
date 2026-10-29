import type { Bindings } from '../../platform/bindings.server'
import { newUlid } from '../../platform/identifiers.server'
import {
  completeJob,
  createJob,
  dashboard,
  healthCheck,
  jobById,
  publicArticles,
  recordSchedule,
} from './repository.server'

export async function readPublicArticles(bindings: Bindings) {
  return publicArticles(bindings)
}

export async function checkHealth(bindings: Bindings): Promise<void> {
  await healthCheck(bindings)
}

export async function readDashboard(bindings: Bindings) {
  return dashboard(bindings)
}

export async function queueReferenceJob(bindings: Bindings) {
  const id = newUlid()
  await createJob(bindings, {
    id,
    kind: 'reference.lifecycle.v1',
    state: 'queued',
    createdAt: new Date().toISOString(),
  })
  await bindings.JOBS.send({ id })
  return { id }
}

export async function completeReferenceJob(bindings: Bindings, id: string) {
  return completeJob(bindings, id, new Date().toISOString())
}

export async function readJob(bindings: Bindings, id: string) {
  return jobById(bindings, id)
}

export async function recordScheduledRun(bindings: Bindings, cron: string) {
  await recordSchedule(bindings, { id: newUlid(), cron, ranAt: new Date().toISOString() })
}
