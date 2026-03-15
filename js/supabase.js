import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrvbmzjsivxlcodsdvrb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydmJtempzaXZ4bGNvZHNkdnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkxNTYsImV4cCI6MjA4ODEzNTE1Nn0.gBu0RL9tHBCjYmkiupziTPAsVX3s8TovUdMhjWPjiLw'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function insertRecord(table, data) {
  const { data: inserted, error } = await supabase.from(table).insert([data])
  if (error) throw error
  return inserted
}

async function saveTrackRecord(record) {
  const payload = Object.assign({}, record, { created_at: new Date().toISOString() })
  return insertRecord('track_records', payload)
}

async function saveHistory(history) {
  // Accepts either { user_id, events: [...] } or a single history object
  if (history && Array.isArray(history.events)) {
    const rows = history.events.map((e) => ({ user_id: history.user_id, event: e, created_at: new Date().toISOString() }))
    const { data, error } = await supabase.from('history').insert(rows)
    if (error) throw error
    return data
  }
  const payload = Object.assign({}, history, { created_at: new Date().toISOString() })
  return insertRecord('history', payload)
}

export { supabase, insertRecord, saveTrackRecord, saveHistory }

export default { supabase, insertRecord, saveTrackRecord, saveHistory }
