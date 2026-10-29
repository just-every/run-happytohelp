import { createFileRoute } from '@tanstack/react-router'
import { loadPublicArticles } from '../core/app/loaders'
import { HydrationUnit } from "../vendor/base/hydration/unit"

export const Route = createFileRoute('/records')({
  loader: () => loadPublicArticles(),
  component: PublicRecord,
})

function PublicRecord() {
  const articles = Route.useLoaderData()
  return (
    <HydrationUnit>
      <section>
        {/* A one-time entrance: data-intro, declared under prefers-reduced-motion: no-preference. */}
        <h1 data-intro>Server-rendered public record</h1>
        <p>Its loader crosses a Start server-function boundary before it reads <code>D1</code>.</p>
        {articles.map((article) => (
          <article key={article.slug}>
            <h2>{article.title}</h2>
            <p>{article.body}</p>
          </article>
        ))}
      </section>
    </HydrationUnit>
  )
}
