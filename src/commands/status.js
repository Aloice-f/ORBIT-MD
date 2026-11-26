import * as store from '../store.js'
import { recent, fetchStatus } from '../status.js'
import { digits, quotedOf } from '../utils.js'

export const toggle = (key, label, category = 'Status') => ({
  name: key, category, desc: `${label}: on or off`, owner: true,
  run: ({ args, reply }) => {
    const v = (args[0] || '').toLowerCase()
    if (!['on', 'off'].includes(v)) return reply(`${label} is ${store.get(key) ? 'on' : 'off'}. Use .${key} on or .${key} off`)
    store.set(key, v === 'on')
    reply(`${label} is now ${v}.`)
  }
})

export default [
  toggle('autoviewstatus', 'Auto view status'),
  toggle('autolikestatus', 'Auto like status'),
  {
    name: 'setstatusemoji', category: 'Status', desc: 'Emoji used when liking statuses', owner: true,
    run: ({ text, reply }) => {
      if (!text) return reply(`Current emoji: ${store.get('statusEmoji')}. Use .setstatusemoji 🔥`)
      store.set('statusEmoji', text.split(/\s+/)[0])
      reply('Status emoji updated.')
    }
  },
  {
    name: 'save', aliases: ['statusdl'], category: 'Status', desc: 'Reply to a status or media to save it here', owner: true,
    run: async ({ sock, msg, jid, reply }) => {
      const q = quotedOf(msg, jid)
      if (!q) return reply('Reply to a status (or a photo, video or voice note) with .save')
      const out = await fetchStatus(sock, q)
      if (!out) return reply('There is nothing to save in that message.')
      await sock.sendMessage(jid, out, { quoted: msg })
    }
  },
  {
    name: 'statuslist', category: 'Status', desc: 'Who posted a status in the last 24h', owner: true,
    run: ({ reply }) => {
      const r = [...recent()]
      if (!r.length) return reply('No statuses seen yet. Statuses only arrive while the bot is connected.')
      reply('Statuses in the last 24h:\n' + r.map(([jid, l]) => `@${digits(jid)}: ${l.length}`).join('\n'), { mentions: r.map(([j]) => j) })
    }
  },
  {
    name: 'getstatus', category: 'Status', desc: 'Send a contact\'s recent statuses: .getstatus @user or number', owner: true,
    run: async ({ sock, msg, jid, args, reply }) => {
      const ctx = msg.message?.extendedTextMessage?.contextInfo
      const want = digits(ctx?.mentionedJid?.[0] || ctx?.participant || args[0] || '').replace(/\D/g, '')
      if (!want) return reply('Use .getstatus @user, reply to them, or .getstatus 254712345678')
      const hit = [...recent()].find(([j]) => digits(j) === want)
      if (!hit) return reply('No status from them in the last 24h (only ones seen while connected).')
      for (const item of hit[1].slice(-5)) {
        const out = await fetchStatus(sock, item)
        if (out) await sock.sendMessage(jid, out)
      }
    }
  }
]
