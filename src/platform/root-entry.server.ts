import { env } from 'cloudflare:workers';
import type { Env } from './env';
import { nativeLoaderResponse, nativeLoaderError } from './native-loader.server';
import { installationContact } from '../modules/public-site/installation-contact';
import { getKnowledgeExperience } from '../modules/knowledge/experience';

/** The app root uses native first-run/session authority; the static site has its own entry. */
export async function installationRootDestination(): Promise<string | null> {
  const response = await nativeLoaderResponse('/api/identity/setup');
  if (!response.ok) throw await nativeLoaderError(response);
  const setup = await response.json() as { available: boolean; signedIn?: boolean };
  if (setup.available || setup.signedIn) return null;

  const bindings = env as unknown as Env;
  // Reuse the retained installation workspace, never an arbitrary tenant or a browser hint.
  const workspace = await installationContact(bindings);
  if (!workspace) return '/login';
  const published = await bindings.DB.prepare("SELECT 1 FROM knowledge_articles WHERE project_id=? AND status='published' LIMIT 1")
    .bind(workspace.id).first();
  const experience = await getKnowledgeExperience(bindings, workspace.id);
  // An explicit address ('' selects built-in paths) or deployment-approved host publishes help.
  const enabled = experience.publishedHost !== null || experience.approvedHosts.length > 0;
  return published || enabled ? `/help/${encodeURIComponent(workspace.id)}` : '/login';
}
