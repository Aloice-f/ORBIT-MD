import pino from 'pino'
import { downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys'
import * as store from './store.js'

const logger = pino({ level: 'silent' })
const DAY = 24 * 60 * 60_000
const seen = new Map() // poster jid -> [{ key, message, ts }]  (only statuses that arrived while connected)

/** Statuses from the last 24h, newest last. */
export function recent() {
  const out = new Map()
  for (const [jid, list] of seen) {
    const fresh = list.filter((s) => Date.now() - s.ts < DAY)
    if (fresh.length) out.set(jid, fresh)
    else seen.delete(jid)
  }
  return out
}

/** Called for every incoming status: remember it, then auto view / like if those are on. */
export async function onStatus(sock, msg) {
  const who = msg.key.participant
  if (msg.key.fromMe || !msg.message || !who) return
  seen.set(who, [...(seen.get(who) ?? []), { key: msg.key, message: msg.message, ts: Date.now() }].slice(-10))

  const view = store.get('autoviewstatus')
  const like = store.get('autolikestatus')
  if (view || like) await sock.readMessages([msg.key])
  if (like) {
    await sock.sendMessage(
      'status@broadcast',
      { react: { text: store.get('statusEmoji') || '💚', key: msg.key } },
      { statusJidList: [jidNormalizedUser(who), jidNormalizedUser(sock.user.id)] }
    )
  }
}

/** Turn a stored status or replied-to message into something sock.sendMessage can send (or null). */
export async function fetchStatus(sock, { key, message }) {
  const text = message.conversation ?? message.extendedTextMessage?.text
  if (text) return { text }
  const type = ['imageMessage', 'videoMessage', 'audioMessage'].find((t) => message[t])
  if (!type) return null
  const buffer = await downloadMediaMessage({ key, message }, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })
  const inner = message[type]
  if (type === 'audioMessage') return { audio: buffer, mimetype: inner.mimetype, ptt: Boolean(inner.ptt) }
  return { [type === 'imageMessage' ? 'image' : 'video']: buffer, caption: inner.caption || '' }
}
