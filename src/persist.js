import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { config } from './config.js'
import * as store from './store.js'

// Optional: back up login keys + settings to YOUR Supabase project (plain REST, no SDK).
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_KEY || ''
export const enabled = Boolean(BASE && KEY)
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const table = `${BASE}/rest/v1/orbit_kv`
let botId = null
const timers = {}

const rowUrl = (key) => `${table}?id=eq.${encodeURIComponent(botId)}&key=eq.${key}`

async function read(key) {
  const r = await fetch(`${rowUrl(key)}&select=value`, { headers })
  if (!r.ok) throw new Error(`Supabase read failed (${r.status})`)
  return (await r.json())[0]?.value ?? null
}

async function write(key, value) {
  const r = await fetch(`${table}?on_conflict=id,key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: botId, key, value, updated_at: new Date().toISOString() })
  })
  if (!r.ok) throw new Error(`Supabase write failed (${r.status})`)
}

export function packAuth(dir = config.authDir) {
  const files = {}
  for (const f of fs.readdirSync(dir)) files[f] = fs.readFileSync(path.join(dir, f), 'utf8')
  return zlib.gzipSync(JSON.stringify(files)).toString('base64')
}

export function unpackAuth(b64, dir = config.authDir) {
  const files = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString())
  fs.mkdirSync(dir, { recursive: true })
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, path.basename(f)), text)
}

/** Call before the bot connects. Newer keys from Supabase win over the pasted SESSION_ID. */
export async function restore(id) {
  botId = id
  if (!enabled) return
  try {
    if (!fs.existsSync(path.join(config.authDir, 'creds.json'))) {
      const auth = await read('auth')
      if (auth) { unpackAuth(auth); console.log('Restored login from Supabase') }
    }
    const s = await read('settings')
    if (s) store.replace(JSON.parse(s))
  } catch (e) {
    console.error('Supabase restore skipped:', e.message)
  }
}

const later = (name, ms, fn) => {
  clearTimeout(timers[name])
  timers[name] = setTimeout(() => fn().catch((e) => console.error('Backup failed:', e.message)), ms)
}
const saveAuth = async () => { if (fs.existsSync(config.authDir)) await write('auth', packAuth()) }
const saveSettings = () => write('settings', JSON.stringify(store.all()))

export function start() {
  if (enabled && botId) store.onSave(() => later('settings', 3_000, saveSettings))
}
export function backupAuthSoon() {
  if (enabled && botId) later('auth', 20_000, saveAuth)
}
/** Write everything now (used on shutdown). */
export async function flush() {
  if (!enabled || !botId) return
  Object.values(timers).forEach(clearTimeout)
  try { await Promise.all([saveAuth(), saveSettings()]) } catch (e) { console.error('Final backup failed:', e.message) }
}
/** Forget the backed-up login (after a logout) so a stale copy is not restored. */
export async function wipe() {
  if (enabled && botId) await fetch(rowUrl('auth'), { method: 'DELETE', headers }).catch(() => {})
}
