import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { config } from './config.js'

export const SESSION_PREFIX = 'ORBIT~'

/** creds.json text -> "ORBIT~<gzip+base64url>" (a few KB, safe to paste anywhere). */
export const encodeSession = (credsJson) => SESSION_PREFIX + zlib.gzipSync(credsJson).toString('base64url')

/**
 * Session ID -> creds.json text. Throws if it is not a valid session.
 * Tolerant of quotes, spaces, line breaks and extra text around the ID.
 */
export function decodeSession(id) {
  const m = String(id).replace(/\s+/g, '').match(/ORBIT~([A-Za-z0-9_-]+)/)
  if (!m) throw new Error('SESSION_ID must start with ORBIT~')
  const json = zlib.gunzipSync(Buffer.from(m[1], 'base64url')).toString()
  const creds = JSON.parse(json)
  if (!creds?.noiseKey || !creds?.signedIdentityKey) throw new Error('Not a WhatsApp session')
  return json
}

/** The WhatsApp number inside a session (used to key backups). */
export const sessionNumber = (credsJson) => String(JSON.parse(credsJson).me?.id ?? 'default').split(/[:@]/)[0]

/** The raw SESSION_ID value, from the environment or session.txt ('' if none). */
export const readRaw = () => process.env.SESSION_ID || (fs.existsSync('session.txt') ? fs.readFileSync('session.txt', 'utf8') : '')

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
  fs.writeFileSync(file, decodeSession(raw))
  return true
}