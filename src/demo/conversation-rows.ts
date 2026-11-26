type SeedValue = string | number | null

const rows = (columns: string) => ({ columns, values: [] as SeedValue[][] })

// Insert parent records first. Message and authorship triggers maintain the
// inbox projections, and ratings and their history follow the resolutions.
export function conversationRows() {
  return {
    contacts: rows('id,project_id,name,email,external_id,created_at,is_verified,metadata_json'),
    conversations: rows('id,project_id,contact_id,revision,last_message_id,assigned_to,resolved_at,created_at,updated_at'),
    messages: rows('id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,content_raw'),
    ai_generations: rows('id,project_id,conversation_id,state,source_revision,source_context_revision,source_last_message_id,actor_json,model,ai_id,ai_profile_json,kind,instruction,options_json,created_at,updated_at,error,output_json'),
    email_deliveries: rows('id,project_id,recipient,subject,intent_hash,state,provider_id,error,created_at,updated_at'),
    message_authorship: rows('message_id,project_id,kind,source_kind,source_id,source_part,recorded_at'),
    conversation_tracking: rows('conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at,cycle_epoch,first_resolved_at'),
    conversation_ai: rows('conversation_id,ai_id'),
    conversation_resolutions: rows('id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json'),
    conversation_ratings: rows('resolution_id,value,comment,updated_at,revision'),
    conversation_rating_history: rows('id,resolution_id,value,comment,created_at,revision'),
    context_tracked_events: rows('id,project_id,subject_id,local_id,type,payload,created_at'),
    conversation_tags: rows('project_id,conversation_id,tag_id'),
    conversation_notes: rows('id,conversation_id,user_id,content,created_at'),
    conversation_reads: rows('conversation_id,user_id,revision'),
  }
}

export function insertConversationRows(db: D1Database, data: ReturnType<typeof conversationRows>) {
  const statements: D1PreparedStatement[] = []
  for (const [table, { columns, values }] of Object.entries(data)) {
    const width = columns.split(',').length
    const row = `(${Array(width).fill('?').join(',')})`
    const rowsPerInsert = Math.floor(100 / width) // D1 allows 100 bound values per statement.
    for (let index = 0; index < values.length; index += rowsPerInsert) {
      const batch = values.slice(index, index + rowsPerInsert)
      const placeholders = batch.map(() => row).join(',')
      statements.push(db.prepare(`INSERT OR IGNORE INTO ${table}(${columns}) VALUES ${placeholders}`).bind(...batch.flat()))
    }
  }
  return statements
}
