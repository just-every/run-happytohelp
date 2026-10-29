import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const articles = sqliteTable('articles', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  publishedAt: text('published_at').notNull(),
})

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
})

export const scheduledRuns = sqliteTable('scheduled_runs', {
  id: text('id').primaryKey(),
  cron: text('cron').notNull(),
  ranAt: text('ran_at').notNull(),
})
