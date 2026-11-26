import os from 'node:os'
import { config, state, prefix, botName } from '../config.js'
import { sendBanner } from '../utils.js'

const SMALL = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' }
const sc = (s) => [...String(s).toLowerCase()].map((c) => SMALL[c] ?? c).join('')
const ORDER = ['General', 'Owner', 'Group', 'Status', 'AI', 'Media', 'Download', 'Fun', 'Tools']
const PLATFORM = { linux: '𝙇𝙄𝙉𝙐𝙓', win32: '𝙒𝙄𝙉𝘿𝙊𝙒𝙎', darwin: '𝙈𝘼𝘾', android: '𝘼𝙉𝘿𝙍𝙊𝙄𝘿' }
const rank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : 99)

export default [
  {
    name: 'menu', aliases: ['help', 'commands', 'list'], category: 'General', desc: 'Show the command menu with a picture',
    run: async ({ sock, jid, msg, commands, text }) => {
      const want = text.trim().toLowerCase()
      const cats = {}
      for (const c of new Set(commands)) (cats[c.category ?? 'General'] ??= []).push(c.name)
      const keys = Object.keys(cats).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).filter((k) => !want || k.toLowerCase() === want)
      if (!keys.length) return sock.sendMessage(jid, { text: `No section called "${want}". Try ${prefix()}menu` }, { quoted: msg })

      const header =
        `*╭─═══════════════⊷❍*\n` +
        `*┋ ${sc('bot name')}: ${botName()}*\n` +
        `*┋ ${sc('commands')}: ${new Set(commands).size}*\n` +
        `*┋ ${sc('prefix')}: ${prefix()}*\n` +
        `*┋ ${sc('platform')}: ${PLATFORM[os.platform()] ?? os.platform().toUpperCase()}*\n` +
        `*┋ ${sc('owner')}: ${config.ownerName}*\n` +
        `*┋ ${sc('mode')}: ${state.mode === 'private' ? '𝙋𝙍𝙄𝙑𝘼𝙏𝙀' : '𝙋𝙐𝘽𝙇𝙄𝘾'}*\n` +
        `*╰══════════════════⍟*`
      const body = keys
        .map((k) => `╭─⧼ \`${sc(k)}\` ⧽─┈≽\n` + cats[k].map((n, i) => `*│✾${i === cats[k].length - 1 ? '└' : '├'}─⋄* *${sc(n)}*`).join('\n') + `\n╰──────────┈⊷`)
        .join('\n')
      await sendBanner(sock, jid, `${header}\n${body}\n\n> 𝐏ᴏᴡᴇʀᴇᴅ 𝐁ʏ ${config.ownerName}\n> ${prefix()}menu <section> to open one`, { quoted: msg })
    }
  }
]
