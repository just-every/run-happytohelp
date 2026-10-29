import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Bindings } from '../../platform/bindings.server'
import {
  articles,
  jobs,
  scheduledRuns,
} from '../../platform/db/schema'

function database(bindings: Bindings) {
  return drizzle(bindings.DB)
}

export async function healthCheck(bindings: Bindings): Promise<void> {
  await database(bindings).select({ slug: articles.slug }).from(articles).limit(1)
}

export async function publicArticles(bindings: Bindings) {
  return database(bindings)
    .select({ slug: articles.slug, title: articles.title, body: articles.body })
    .from(articles)
    .orderBy(desc(articles.publishedAt))
}

export async function createJob(
  bindings: Bindings,
  job: { id: string; kind: string; state: 'queued'; createdAt: string },
): Promise<void> {
  await database(bindings).insert(jobs).values(job)
}

export async function completeJob(
  bindings: Bindings,
  id: string,
  completedAt: string,
): Promise<boolean> {
  const result = await database(bindings)
    .update(jobs)
    .set({ state: 'completed', completedAt })
    .where(and(eq(jobs.id, id), eq(jobs.state, 'queued')))

  return result.meta.changes > 0
}

export async function jobById(bindings: Bindings, id: string) {
  const [job] = await database(bindings)
    .select({ id: jobs.id, kind: jobs.kind, state: jobs.state })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1)

  return job
}

export async function dashboard(bindings: Bindings) {
  const [job] = await database(bindings)
    .select({ id: jobs.id, state: jobs.state })
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(1)
  const [schedule] = await database(bindings)
    .select({ cron: scheduledRuns.cron, ranAt: scheduledRuns.ranAt })
    .from(scheduledRuns)
    .orderBy(desc(scheduledRuns.ranAt))
    .limit(1)

  return { latestJob: job ?? null, latestSchedule: schedule ?? null }
}

export async function recordSchedule(
  bindings: Bindings,
  schedule: { id: string; cron: string; ranAt: string },
): Promise<void> {
  await database(bindings).insert(scheduledRuns).values(schedule)
}
