import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { config, state } from './config.js'
import { commands, byName } from './commands/index.js'

const digits = (jid = '') => String(jid).split('@')[0].split(':')[0]

function textOf(m) {
  const x = m.message
  if (!x) return ''
  const c = x.ephemeralMessage?.message ?? x
  return c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? ''
}

export async function handle(sock, msg) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return
  const text = textOf(msg).trim()
  if (!text.startsWith(config.prefix)) return

  const [name, ...args] = text.slice(config.prefix.length).trim().split(/\s+/)
  const cmd = byName.get(name.toLowerCase())
  if (!cmd) return

  const jid = msg.key.remoteJid
  const isGroup = jid.endsWith('@g.us')
  const sender = jidNormalizedUser(msg.key.fromMe ? sock.user.id : msg.key.participant || jid)
  const isOwner = msg.key.fromMe || digits(sender) === digits(sock.user.id) || config.owners.includes(digits(sender))
  if (state.mode === 'private' && !isOwner) return

  const reply = (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg })

  if (cmd.owner && !isOwner) return reply('Owner only.')
  if ((cmd.group || cmd.admin) && !isGroup) return reply('Use this in a group.')

  let meta
  if (cmd.group || cmd.admin) {
    meta = await sock.groupMetadata(jid)
    const isAdmin = (j) => meta.participants.some((p) => p.admin && [p.id, p.jid].some((x) => x && digits(x) === digits(j)))
    if (cmd.admin && !isOwner && !isAdmin(sender)) return reply('Group admins only.')
    if (cmd.botAdmin && !isAdmin(sock.user.id)) return reply('Make me a group admin first.')
  }

  try {
    await cmd.run({ sock, msg, jid, args, text: args.join(' '), reply, sender, isOwner, meta, commands })
  } catch (e) {
    console.error(`Command ${cmd.name} failed:`, e.message)
    reply('Something went wrong running that command.').catch(() => {})
  }
}
