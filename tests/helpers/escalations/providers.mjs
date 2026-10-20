import { startGitHub } from './github.mjs';
import { startLinear } from './linear.mjs';
import { startJira } from './jira.mjs';
import { startSlack } from './slack.mjs';

/** Four real loopback HTTP servers with provider-shaped network responses.
 * Always close in finally. These helpers register no tests and touch no app state.
 */
export async function startProviders() {
  const results = await Promise.allSettled([startGitHub(), startLinear(), startJira(), startSlack()]);
  const opened = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) {
    await Promise.allSettled(opened.map(provider => provider.close()));
    throw failed.reason;
  }
  const [github, linear, jira, slack] = opened;
  return { github, linear, jira, slack, close: () => Promise.all(opened.map(provider => provider.close())) };
}
