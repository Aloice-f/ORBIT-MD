import { config } from './config.js'
import * as store from './store.js'
import { digits, textOf, getMeta, dropMeta, isAdminIn } from './utils.js'

const LINK = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/)\S+/i

/** Anti-link. Returns true when it removed the message, so the handler can stop. */
export async function guard(sock, msg) {
  const jid = msg.key.remoteJid
  if (!jid.endsWith('@g.us') || msg.key.fromMe || !msg.message) return false
  const mode = store.group(jid).antilink
  if (!mode || mode === 'off' || !LINK.test(textOf(msg))) return false

  const sender = msg.key.participant
  const meta = await getMeta(sock, jid)
  if (isAdminIn(meta, sender) || config.owners.includes(digits(sender))) return false
  if (!isAdminIn(meta, sock.user.id)) return false // needs admin rights to delete or remove

  await sock.sendMessage(jid, { delete: msg.key })
  if (mode === 'kick') {
    await sock.groupParticipantsUpdate(jid, [sender], 'remove')
    dropMeta(jid)
    await sock.sendMessage(jid, { text: `@${digits(sender)} was removed for sending a link.`, mentions: [sender] })
  } else {
    await sock.sendMessage(jid, { text: `@${digits(sender)} links are not allowed here.`, mentions: [sender] })
  }
  return true
}

export const DEFAULT_WELCOME = 'Welcome {user} to *{group}*! 👋 You are member {count}.'
export const DEFAULT_GOODBYE = 'Goodbye {user}. 👋'

const fill = (tpl, user, meta) =>
  tpl.replaceAll('{user}', '@' + digits(user)).replaceAll('{group}', meta.subject).replaceAll('{count}', String(meta.participants.length))

/** Welcome / goodbye messages when people join or leave. */
export async function onParticipants(sock, { id, participants, action }) {
  const key = action === 'add' ? 'welcome' : action === 'remove' ? 'goodbye' : null
  const g = store.group(id)
  dropMeta(id)
  if (!key || !g[key]) return
  const meta = await getMeta(sock, id)
  const tpl = g[key + 'Text'] || (key === 'welcome' ? DEFAULT_WELCOME : DEFAULT_GOODBYE)
  for (const p of participants) {
    const jid = typeof p === 'string' ? p : p.id
    await sock.sendMessage(id, { text: fill(tpl, jid, meta), mentions: [jid] })
  }
}
