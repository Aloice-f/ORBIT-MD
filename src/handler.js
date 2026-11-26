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
  if (state.mode === 'private' && !isOwner) return console.log(`Ignored ${prefix()}${cmd.name} from ${digits(sender)}: MODE is private and they are not an owner`)

  console.log(`Command ${prefix()}${cmd.name} from ${digits(sender)}${isOwner ? ' (owner)' : ''}`)
  const reply = (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg })
  // Reactions double as a status indicator: ⏳ while the command runs, then ✅ or ❌.
  const react = (emoji) => sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }).catch(() => {})

  if (cmd.owner && !isOwner) return reply('Owner only.')
  if ((cmd.group || cmd.admin) && !isGroup) return reply('Use this in a group.')

  let meta
  if (cmd.group || cmd.admin) {
    meta = await getMeta(sock, jid)
    if (cmd.admin && !isOwner && !isAdminIn(meta, sender)) return reply('Group admins only.')
    if (cmd.botAdmin && !isAdminIn(meta, sock.user.id)) return reply('Make me a group admin first.')
  }

  await react('⏳')
  try {
    await cmd.run({ sock, msg, jid, args, text: args.join(' '), reply, sender, isOwner, meta, commands })
    await react('✅')
  } catch (e) {
    console.error(`Command ${cmd.name} failed:`, e.message)
    await react('❌')
    reply(`${cmd.name} failed: ${e.message}`).catch(() => {})
  }
}
