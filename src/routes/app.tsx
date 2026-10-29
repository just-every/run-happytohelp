import { Outlet, createFileRoute } from '@tanstack/react-router'
import { requireOperator, loadBusinessBrand } from '../core/app/loaders'

export const Route = createFileRoute('/app')({
  beforeLoad: () => requireOperator(),
  loader: () => loadBusinessBrand(),
  head: () => ({ links: [{ rel: 'stylesheet', href: '/rer-business.css' }] }),
  component: AppLayout,
})

function AppLayout() {
  const business = Route.useLoaderData()
  return <>
    <section aria-label="Workspace" className="business-workspace">
      {business.logo ? <img src={business.logo} width="40" height="40" alt="" /> : null}
      <h2>{business.displayName ?? 'Default seed'}</h2>
      {business.ownerName ? <p>{business.ownerName}</p> : null}
      <p>Times shown in {business.timezone}</p>
      <a className="business-primary" href="/app/people">Open people</a>
    </section>
    <Outlet />
  </>
}
