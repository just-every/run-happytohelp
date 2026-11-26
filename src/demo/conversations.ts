import type { Env } from '../platform/env'
import { canonicalActorJson } from '../modules/ai-support/repository'
import { assistant, company, tradeInbox } from './team'
import { conversationRows, insertConversationRows } from './conversation-rows'
import { stories, type Story } from './stories'
import { tagId, type People } from './workspaces'
import type { InboxKey } from './team'

const MINUTE = 60000, HOUR = 3600000

/** Conversations as admission would have left them: messages with authorship, tracking, resolutions with ratings for
 * closed ones, Fern's conversations and generations, AI drafts waiting for review, tags, notes and the owner's reads. */
export function conversationStatements(env: Env, people: People, projects: Record<InboxKey, string>, fernId: string, now: number) {
  const rows = conversationRows()
  const fernProfile = JSON.stringify({ name: assistant.name, model: assistant.model, prompt: assistant.prompt })
  const generation = (id: string, story: Story, conversationId: string, kind: 'reply' | 'suggestions', revision: number, lastMessageId: string | null, actor: unknown, at: number, result: unknown) =>
    rows.ai_generations.values.push([id, projects[story.inbox], conversationId, 'completed', revision, 0, lastMessageId, canonicalActorJson(actor), assistant.model, fernId, fernProfile, kind, '', '{}',
      new Date(at).toISOString(), new Date(at + 4000).toISOString(), null, JSON.stringify({ result, usage: null })])

  for (const story of stories) {
    const projectId = projects[story.inbox], contactId = `demo-contact-${story.key}`, conversationId = `demo-conv-${story.key}`
    const started = now - story.start * HOUR, time = (offset: number) => Math.round(started + offset * MINUTE)
    const last = story.msgs.length - 1, lastAt = time(story.msgs[last][0])
    const aiOnly = !story.agent && story.msgs.some(([, who]) => who === 'ai')
    const resolvedAt = story.state === 'solved' ? lastAt + (aiOnly ? 10 : 3) * MINUTE : null
    const assignee = story.agent ? people[story.agent] : null
    const messageId = (index: number) => `${conversationId}-m${index}`
    rows.contacts.values.push([contactId, projectId, story.name, story.email, null, started, 0,
      JSON.stringify({ ...(story.about ? { description: story.about } : {}), ...(story.phone ? { phone: story.phone } : {}) })])
    rows.conversations.values.push([conversationId, projectId, contactId, story.msgs.length, messageId(last), assignee?.id ?? null, resolvedAt, started, resolvedAt ?? lastAt])
    for (const [index, [offset, who, content]] of story.msgs.entries()) {
      const at = time(offset), id = messageId(index), person = who === 'c' || who === 'ai' ? null : people[who]
      const actor = who === 'c' ? contactId : who === 'ai' ? fernId : person!.id, role = who === 'c' ? 'contact' : who === 'ai' ? 'ai' : person!.role
      rows.messages.values.push([id, projectId, conversationId, `demo:${index}`, actor, role, content, index + 1, at, who === 'c' && story.via === 'email' ? content : null])
      let source: [string, string | null, string | null, string | null] = who === 'c' ? ['visitor', null, null, null] : ['human', 'composer', actor, null]
      if (who === 'ai') {
        const generationId = `${conversationId}-g${index}`
        generation(generationId, story, conversationId, 'reply', index, messageId(index - 1), { id: contactId, projectId, role: 'contact' }, at - 3000, { response: content })
        source = ['ai', 'generation', generationId, null]
      } else if (who !== 'c' && story.assisted && index === story.msgs.findIndex(([, w]) => w !== 'c' && w !== 'ai')) {
        const generationId = `${conversationId}-d${index}`
        generation(generationId, story, conversationId, 'suggestions', index, messageId(index - 1), { id: person!.id, projectId, role: person!.role }, at - 60000,
          { user_goal: '', responses: [{ button: 'Suggested reply', icon: 'message-circle', response: content, use_when: '', evidence_ids: [] }], missing_information: [] })
        source = ['assisted', 'ai-draft', generationId, '0']
      }
      // Each reply was emailed to the customer as admission would have recorded it (the conversation shows "Email sent").
      if (who !== 'c') rows.email_deliveries.values.push([`message:${id}:notification`, projectId, story.email, `New reply from ${story.inbox === 'trade' ? tradeInbox.name : company.name}`,
        `demo:${id}`, 'sent', `demo-seed-${id}`, null, at + 2000, at + 2000])
      rows.message_authorship.values.push([id, projectId, ...source, at])
    }
    rows.conversation_tracking.values.push([conversationId, projectId, 1, 1, resolvedAt ? story.msgs.length : 0, resolvedAt ?? started, 0, resolvedAt])
    if (aiOnly) rows.conversation_ai.values.push([conversationId, fernId])
    if (resolvedAt) {
      const resolutionId = `${conversationId}-r1`, outcome = aiOnly ? 'ai' : story.assisted ? 'assisted' : 'human'
      rows.conversation_resolutions.values.push([resolutionId, projectId, conversationId, contactId, 1, resolvedAt, story.msgs.length, 0, outcome, JSON.stringify({ historyComplete: true })])
      if (story.rating) {
        const [value, comment] = story.rating, ratedAt = resolvedAt + 20 * MINUTE
        rows.conversation_ratings.values.push([resolutionId, value, comment, ratedAt, 1])
        rows.conversation_rating_history.values.push([`${resolutionId}-h1`, resolutionId, value, comment, ratedAt, 1])
      }
    }
    if (assignee) {
      const firstReply = story.msgs.find(([, who]) => who === story.agent)?.[0] ?? story.msgs[0][0]
      const event = `${conversationId}-assigned`
      rows.context_tracked_events.values.push([event, projectId, contactId, event, 'AGENT_ASSIGNED',
        JSON.stringify({ conversation_id: conversationId, bucket_id: conversationId, agent_id: assignee.id, name: assignee.name, is_ai: false, role: 'Support' }), time(firstReply) - MINUTE])
    }
    for (const tag of story.tags ?? []) rows.conversation_tags.values.push([projectId, conversationId, tagId(story.inbox, tag)])
    if (story.note) {
      const [by, offset, content] = story.note
      rows.conversation_notes.values.push([`${conversationId}-note`, conversationId, people[by].id, content, time(offset)])
    }
    if (story.draft) {
      const draft = story.draft, reviewer = assignee ?? people.owner
      const responses = [{ button: draft.button, icon: draft.icon, response: draft.response, use_when: '', evidence_ids: [] as string[] }]
      if (draft.alternative) responses.push({ button: draft.alternative.button, icon: draft.alternative.icon, response: draft.alternative.response, use_when: draft.alternative.when, evidence_ids: [] })
      generation(`${conversationId}-draft`, story, conversationId, 'suggestions', story.msgs.length, messageId(last), { id: reviewer.id, projectId, role: reviewer.role }, lastAt + 30000,
        { user_goal: draft.goal, responses, missing_information: draft.missing ?? [] })
    }
    if (!story.unread) rows.conversation_reads.values.push([conversationId, people.owner.id, story.msgs.length])
  }
  return insertConversationRows(env.DB, rows)
}
