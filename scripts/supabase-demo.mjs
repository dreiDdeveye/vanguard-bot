import { saveTrackRecord, saveHistory } from '../js/supabase.js'

(async function demo() {
  try {
    const track = {
      user_id: 'demo-user',
      action: 'play',
      details: { title: 'Demo Song', artist: 'Demo Artist' }
    }

    const trackRes = await saveTrackRecord(track)
    console.log('Track saved:', trackRes)

    const history = {
      user_id: 'demo-user',
      events: [
        { type: 'play', ts: Date.now(), meta: { track: 'Demo Song' } },
        { type: 'pause', ts: Date.now() + 1000 }
      ]
    }

    const histRes = await saveHistory(history)
    console.log('History saved:', histRes)
  } catch (err) {
    console.error('Supabase demo error:', err.message || err)
    process.exitCode = 1
  }
})()