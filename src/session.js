import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { config } from './config.js'

export const SESSION_PREFIX = 'ORBIT~'

/** Every file in an auth folder (creds.json plus the encryption keys WhatsApp already knows about) -> "ORBIT~...". */
export function encodeSessionDir(dir) {
  const files = {}
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    if (/^[\w.-]+\.json$/.test(name) && fs.statSync(file).isFile()) files[name] = fs.readFileSync(file, 'utf8')
  }
  if (!files['creds.json']) throw new Error('creds.json missing')
  return SESSION_PREFIX + zlib.gzipSync(JSON.stringify({ v: 2, files })).toString('base64url')
}

/** Old style: just creds.json text -> "ORBIT~...". Kept so older code keeps working. */
export const encodeSession = (credsJson) => SESSION_PREFIX + zlib.gzipSync(credsJson).toString('base64url')

/** Session ID -> { fileName: text }. Understands new IDs (with keys) and old creds-only IDs. */
export function decodeFiles(id) {
  const m = String(id).replace(/\s+/g, '').match(/ORBIT~([A-Za-z0-9_-]+)/)
  if (!m) throw new Error('SESSION_ID must start with ORBIT~')
  const json = zlib.gunzipSync(Buffer.from(m[1], 'base64url')).toString()
  const parsed = JSON.parse(json)
  const files = parsed?.v === 2 && parsed.files ? parsed.files : { 'creds.json': json }
  const creds = JSON.parse(files['creds.json'] ?? 'null')
  if (!creds?.noiseKey || !creds?.signedIdentityKey) throw new Error('Not a WhatsApp session')
  return files
}

/** Session ID -> creds.json text. Throws if it is not a valid session. */
export const decodeSession = (id) => decodeFiles(id)['creds.json']

/** The WhatsApp number inside a session (used to key backups). */
export const sessionNumber = (credsJson) => String(JSON.parse(credsJson).me?.id ?? 'default').split(/[:@]/)[0]

/** The raw SESSION_ID value, from the environment or session.txt ('' if none). */
export const readRaw = () => {
  if (process.env.SESSION_ID) return process.env.SESSION_ID
  for (const f of ['session/session.txt', 'session.txt']) {
    if (fs.existsSync(f)) {
      const text = fs.readFileSync(f, 'utf8')
      if (text.trim()) return text
    }
  }
  return ''
}

/**
 * Make sure auth/creds.json exists. Local creds (including ones restored from Supabase) win
 * over SESSION_ID, so newer keys are never reset to the pasted copy. True when a session exists.
 */
export function restoreSession() {
  const file = path.join(config.authDir, 'creds.json')
  if (fs.existsSync(file)) return true
  const raw = readRaw()
  if (!raw.trim()) return false
  fs.mkdirSync(config.authDir, { recursive: true })
  for (const [name, text] of Object.entries(decodeFiles(raw))) {
    if (!/^[\w.-]+\.json$/.test(name)) continue // never write outside the auth folder
    fs.writeFileSync(path.join(config.authDir, name), text)
  }
  return true
}
