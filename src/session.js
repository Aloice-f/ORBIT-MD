import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { config } from './config.js'

export const SESSION_PREFIX = 'ORBIT~'

/** creds.json text -> "ORBIT~<gzip+base64url>" (a few KB, safe to paste anywhere). */
export const encodeSession = (credsJson) => SESSION_PREFIX + zlib.gzipSync(credsJson).toString('base64url')

/** Session ID -> creds.json text. Throws if it is not a valid session. */
export function decodeSession(id) {
  const body = String(id).trim().split('~').pop()
  const json = zlib.gunzipSync(Buffer.from(body, 'base64url')).toString()
  const creds = JSON.parse(json)
  if (!creds?.noiseKey || !creds?.signedIdentityKey) throw new Error('Not a WhatsApp session')
  return json
}

/**
 * Make sure auth/creds.json exists. Local creds win over SESSION_ID, so a host with a
 * persistent disk keeps its newer keys instead of being reset to the pasted copy.
 * Returns true when a session is available.
 */
export function restoreSession() {
  const file = path.join(config.authDir, 'creds.json')
  if (fs.existsSync(file)) return true
  const raw = process.env.SESSION_ID || (fs.existsSync('session.txt') ? fs.readFileSync('session.txt', 'utf8') : '')
  if (!raw.trim()) return false
  fs.mkdirSync(config.authDir, { recursive: true })
  fs.writeFileSync(file, decodeSession(raw))
  return true
}
