export const aiBilling = "AI replies are billed by your AI provider to your key. HappyToHelp doesn't charge for them.";
// The runtime guards apply to automatic replies; recorded cost may be incomplete.
export const dailySafetyLimit = (replies, dollars, installationReplies, resetUtc) => `Automatic AI replies stop after ${replies} replies or about $${dollars} in this workspace, or after ${installationReplies} replies across all workspaces. These daily limits use recorded activity and reset at ${resetUtc} UTC. Set a spending limit with your AI provider too.`;
