import * as store from '../store.js'
import { DEFAULT_WELCOME, DEFAULT_GOODBYE } from '../protection.js'

/** .welcome and .goodbye share the same on / off / set <text> logic. */
const greeting = (key, def) => ({
  name: key, category: 'Group', desc: `${key} messages: on, off or set <text>`, admin: true,
  run: ({ jid, args, text, reply }) => {
    const g = store.group(jid)
    const a = (args[0] || '').toLowerCase()
    if (a === 'on' || a === 'off') { store.setGroup(jid, key, a === 'on'); return reply(`${key} is now ${a}.`) }
    if (a === 'set' && args[1]) {
      store.setGroup(jid, key + 'Text', text.slice(4).trim())
      store.setGroup(jid, key, true)
      return reply(`${key} text saved and turned on.`)
    }
    reply(`${key} is ${g[key] ? 'on' : 'off'}.\nUse .${key} on, .${key} off or .${key} set <text>\nPlaceholders: {user} {group} {count}\nCurrent: ${g[key + 'Text'] || def}`)
  }
})

export default [
  {
    name: 'antilink', category: 'Group', desc: 'Block links: off, delete or kick', admin: true,
    run: ({ jid, args, reply }) => {
      const a = (args[0] || '').toLowerCase()
      if (!['off', 'delete', 'kick'].includes(a)) return reply(`Anti-link is ${store.group(jid).antilink || 'off'}.\nUse .antilink off, .antilink delete or .antilink kick\nI must be a group admin. Admins are never affected.`)
      store.setGroup(jid, 'antilink', a)
      reply(`Anti-link is now ${a}.`)
    }
  },
  greeting('welcome', DEFAULT_WELCOME),
  greeting('goodbye', DEFAULT_GOODBYE),
  {
    name: 'mute', category: 'Group', desc: 'Only admins can send messages', admin: true, botAdmin: true,
    run: async ({ sock, jid, reply }) => { await sock.groupSettingUpdate(jid, 'announcement'); reply('Group muted. Only admins can send messages.') }
  },
  {
    name: 'unmute', category: 'Group', desc: 'Let everyone send messages', admin: true, botAdmin: true,
    run: async ({ sock, jid, reply }) => { await sock.groupSettingUpdate(jid, 'not_announcement'); reply('Group unmuted.') }
  }
]
