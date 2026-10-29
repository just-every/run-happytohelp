import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from "../vendor/base/hydration/unit"

export const Route = createFileRoute('/reference')({ component: ReferencePage })

function ReferencePage() {
  return (
    <HydrationUnit>
      <section>
        <h1>Reference snapshot</h1>
        <p>This invariant public page is emitted into the Worker asset bundle at build time.</p>
      </section>
    </HydrationUnit>
  )
}
