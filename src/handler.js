import fs from 'node:fs'
import path from 'node:path'
import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { config, state, prefix } from './config.js'
import * as store from './store.js'
import { commands, byName } from './commands/index.js'
import { digits, textOf, getMeta, isAdminIn } from './utils.js'

// Each message may run a command only once. WhatsApp can deliver the same message more than once
// (a retry after a decrypt error), and after a restart or crash it replays messages the bot already answered.
// So: remember handled message ids ON DISK (they survive a restart), and ignore anything older than this start.
const BOOT = Date.now() / 1000
const HANDLED_FILE = path.join(process.env.DATA_DIR || 'data', 'handled.json')
const handled = new Map()
try {
  for (const [id, t] of Object.entries(JSON.parse(fs.readFileSync(HANDLED_FILE, 'utf8')))) if (Date.now() - t < 900_000) handled.set(id, t)
} catch {}
function alreadyHandled(msg) {
  const now = Date.now()
  for (const [id, t] of handled) if (now - t > 900_000) handled.delete(id)
  const id = `${msg.key.remoteJid}|${msg.key.id}`
  if (handled.has(id)) return true
  handled.set(id, now)
  try { // written before the command runs, so even a crash mid-command cannot cause a re-run
    fs.mkdirSync(path.dirname(HANDLED_FILE), { recursive: true })
    fs.writeFileSync(HANDLED_FILE, JSON.stringify(Object.fromEntries(handled)))
  } catch {}
  return false
}

export async function handle(sock, msg) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return
  const text = textOf(msg).trim()
  if (!text.startsWith(prefix())) return
  if (Number(msg.messageTimestamp || 0) < BOOT - 15) return // sent before the bot started: already answered, or too old to matter
  if (alreadyHandled(msg)) return

  const [name, ...args] = text.slice(prefix().length).trim().split(/\s+/)
  const cmd = byName.get(name.toLowerCase())
  if (!cmd) return

  const jid = msg.key.remoteJid
  const isGroup = jid.endsWith('@g.us')
  const sender = jidNormalizedUser(msg.key.fromMe ? sock.user.id : msg.key.participant || jid)
  const isOwner = msg.key.fromMe || digits(sender) === digits(sock.user.id) || config.owners.includes(digits(sender)) || (store.get('sudo') ?? []).includes(digits(sender))
  if (state.mode === 'private' && !isOwner) return console.log(`Ignored ${prefix()}${cmd.name} from ${digits(sender)}: MODE is private and they are not an owner`)

  console.log(`Command ${prefix()}${cmd.name} [${msg.key.id?.slice(0, 8)}] from ${digits(sender)}${isOwner ? ' (owner)' : ''} via ${digits(sock.user.id)}`)
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

  // Start the command straight away. The ⏳ reaction is sent alongside it (not before it), and the final ✅/❌
  // always follows it, so the answer is never held up waiting for a reaction to go out.
  const started = react('⏳')
  try {
    await cmd.run({ sock, msg, jid, args, text: args.join(' '), reply, sender, isOwner, meta, commands })
    started.then(() => react('✅'))
  } catch (e) {
    console.error(`Command ${cmd.name} failed:`, e.message)
    started.then(() => react('❌'))
    reply(`${cmd.name} failed: ${e.message}`).catch(() => {})
  }
}