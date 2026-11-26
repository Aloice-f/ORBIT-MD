import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { config, state, prefix } from './config.js'
import * as store from './store.js'
import { commands, byName } from './commands/index.js'
import { digits, textOf, getMeta, isAdminIn } from './utils.js'

export async function handle(sock, msg) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return
  const text = textOf(msg).trim()
  if (!text.startsWith(prefix())) return

  const [name, ...args] = text.slice(prefix().length).trim().split(/\s+/)
  const cmd = byName.get(name.toLowerCase())
  if (!cmd) return

  const jid = msg.key.remoteJid
  const isGroup = jid.endsWith('@g.us')
  const sender = jidNormalizedUser(msg.key.fromMe ? sock.user.id : msg.key.participant || jid)
  const isOwner = msg.key.fromMe || digits(sender) === digits(sock.user.id) || config.owners.includes(digits(sender)) || (store.get('sudo') ?? []).includes(digits(sender))
  if (state.mode === 'private' && !isOwner) return

  const reply = (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg })

  if (cmd.owner && !isOwner) return reply('Owner only.')
  if ((cmd.group || cmd.admin) && !isGroup) return reply('Use this in a group.')

  let meta
  if (cmd.group || cmd.admin) {
    meta = await getMeta(sock, jid)
    if (cmd.admin && !isOwner && !isAdminIn(meta, sender)) return reply('Group admins only.')
    if (cmd.botAdmin && !isAdminIn(meta, sock.user.id)) return reply('Make me a group admin first.')
  }

  try {
    await cmd.run({ sock, msg, jid, args, text: args.join(' '), reply, sender, isOwner, meta, commands })
  } catch (e) {
    console.error(`Command ${cmd.name} failed:`, e.message)
    reply(`That did not work (${cmd.name}). Try again in a moment.`).catch(() => {})
  }
}
