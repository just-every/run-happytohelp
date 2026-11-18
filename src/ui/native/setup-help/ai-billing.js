export const aiBilling = "AI replies are billed by your AI provider to your key. HappyToHelp doesn't charge for them.";
// The runtime guards apply to automatic replies; recorded cost may be incomplete.
export const dailySafetyLimit = (replies, dollars) => `Stops automatic AI replies after ${replies} replies or about $${dollars} a day, based on recorded use. This is our limit, not your provider's: set a spending limit with your provider too.`;
