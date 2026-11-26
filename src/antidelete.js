import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { digits } from './utils.js'
import { fetchStatus } from './status.js'

const cache = new Map() // message id -> message (only filled while antidelete is on)

export function remember(m) {
  if (!m.message || m.key.fromMe || m.message.protocolMessage) return
  cache.set(m.key.id, m)
  if (cache.size > 500) cache.delete(cache.keys().next().value)
}

/** When someone deletes a message, send a copy to the bot's own chat. */
export async function onRevoke(sock, m) {
  const p = m.message?.protocolMessage
  if (p?.type !== 0 || !p.key?.id) return
  const old = cache.get(p.key.id)
  if (!old) return
  const out = await fetchStatus(sock, old)
  if (!out) return
  const me = jidNormalizedUser(sock.user.id)
  const who = old.key.participant || old.key.remoteJid
  const where = old.key.remoteJid === 'status@broadcast' ? 'a status' : old.key.remoteJid.endsWith('@g.us') ? 'a group' : 'a chat'
  await sock.sendMessage(me, { text: `🗑️ @${digits(who)} deleted a message in ${where}:`, mentions: [who] })
  await sock.sendMessage(me, out)
}
