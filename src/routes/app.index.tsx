import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { OperatorAccess } from '../core/features/auth/access'
import { loadPrivateDashboard } from '../core/app/loaders'

export const Route = createFileRoute('/app/')({
  loader: () => loadPrivateDashboard(),
  component: OperatorApp,
})

function OperatorApp() {
  const dashboard = Route.useLoaderData()
  const business = getRouteApi('/app').useLoaderData()
  return (
    <section>
      <h1>Native session protected operator app</h1>
      <p>The private loader runs only after the parent session gate passes.</p>
      <p>Latest job: {dashboard.latestJob?.state ?? 'none'}</p>
      <p>Latest cron: {dashboard.latestSchedule?.cron ?? 'none'}</p>
      <p><a href="/app/people">People and recent activity</a></p>
      <p><a href="/app/import">Move your people in</a></p>
      <p><a href="/app/policies">Scheduled policy approvals</a></p>
      <OperatorAccess timezone={business.timezone} />
    </section>
  )
}
