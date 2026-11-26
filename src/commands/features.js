import * as store from '../store.js'
import { digits, targetOf, quotedOf } from '../utils.js'
import { fetchStatus } from '../status.js'
import { toggle } from './status.js'

const sudoList = () => store.get('sudo') ?? []

export default [
  toggle('antidelete', 'Anti-delete (copies deleted messages to your own chat)', 'Owner'),
  toggle('autoread', 'Auto read messages', 'Owner'),
  toggle('autotyping', 'Auto typing indicator', 'Owner'),
  toggle('anticall', 'Anti-call (rejects calls)', 'Owner'),
  {
    name: 'vv', category: 'Owner', desc: 'Reply to a view-once photo/video to reveal it', owner: true,
    run: async ({ sock, msg, jid, reply }) => {
      const q = quotedOf(msg, jid)
      const m = q?.message
      const inner = m?.viewOnceMessageV2?.message ?? m?.viewOnceMessage?.message ?? m?.viewOnceMessageV2Extension?.message ?? null
      if (!inner) return reply('Reply to a view-once photo or video with .vv')
      const out = await fetchStatus(sock, { key: q.key, message: inner })
      if (!out) return reply('I could not open that message.')
      await sock.sendMessage(jid, out, { quoted: msg })
    }
  },
  {
    name: 'setprefix', category: 'Owner', desc: 'Change the command prefix: .setprefix ! (or reset)', owner: true,
    run: ({ args, reply }) => {
      const p = args[0]
      if (!p || p.length > 3) return reply('Use .setprefix ! (1 to 3 characters) or .setprefix reset')
      store.set('prefix', p === 'reset' ? '' : p)
      reply(p === 'reset' ? 'Prefix reset to the default.' : `Prefix is now ${p}`)
    }
  },
  {
    name: 'setbotname', category: 'Owner', desc: 'Rename the bot on the menu', owner: true,
    run: ({ text, reply }) => {
      if (!text) return reply('Use .setbotname My Bot')
      store.set('botName', text.slice(0, 30))
      reply('Bot name updated.')
    }
  },
  {
    name: 'addsudo', category: 'Owner', desc: 'Give someone owner rights: reply, mention or number', owner: true,
    run: ({ msg, args, reply }) => {
      const t = targetOf(msg, args[0])
      if (!t) return reply('Mention someone, reply to them, or give a number.')
      store.set('sudo', [...new Set([...sudoList(), digits(t)])])
      reply(`@${digits(t)} can now use owner commands.`, { mentions: [t] })
    }
  },
  {
    name: 'removesudo', category: 'Owner', desc: 'Remove someone\'s owner rights', owner: true,
    run: ({ msg, args, reply }) => {
      const t = targetOf(msg, args[0])
      if (!t) return reply('Mention someone, reply to them, or give a number.')
      store.set('sudo', sudoList().filter((n) => n !== digits(t)))
      reply(`@${digits(t)} was removed.`, { mentions: [t] })
    }
  },
  {
    name: 'listsudo', category: 'Owner', desc: 'List extra owners', owner: true,
    run: ({ reply }) => reply(sudoList().length ? 'Extra owners:\n' + sudoList().map((n) => '+' + n).join('\n') : 'No extra owners yet.')
  },
  ...['block', 'unblock'].map((a) => ({
    name: a, category: 'Owner', desc: `${a} a number: reply, mention or number`, owner: true,
    run: async ({ sock, msg, args, reply }) => {
      const t = targetOf(msg, args[0])
      if (!t) return reply('Mention someone, reply to them, or give a number.')
      await sock.updateBlockStatus(t, a)
      reply(`${a === 'block' ? 'Blocked' : 'Unblocked'} +${digits(t)}`)
    }
  })),
  {
    name: 'ginfo', category: 'Group', desc: 'Group details', group: true,
    run: ({ meta, reply }) =>
      reply(`*${meta.subject}*\nMembers: ${meta.participants.length}\nAdmins: ${meta.participants.filter((p) => p.admin).length}\nCreated: ${new Date(meta.creation * 1000).toDateString()}\n\n${meta.desc || 'No description.'}`)
  },
  {
    name: 'admins', category: 'Group', desc: 'List and mention the admins', group: true,
    run: ({ meta, reply }) => {
      const a = meta.participants.filter((p) => p.admin).map((p) => p.id)
      reply('*Group admins*\n' + a.map((j) => '@' + digits(j)).join('\n'), { mentions: a })
    }
  },
  {
    name: 'delete', aliases: ['del'], category: 'Group', desc: 'Reply to a message to delete it', admin: true, botAdmin: true,
    run: async ({ sock, jid, msg, reply }) => {
      const ctx = msg.message?.extendedTextMessage?.contextInfo
      if (!ctx?.stanzaId) return reply('Reply to the message you want deleted.')
      await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: ctx.stanzaId, participant: ctx.participant } })
    }
  },
  {
    name: 'dice', category: 'Fun', desc: 'Roll a dice', run: ({ reply }) => reply('🎲 ' + (1 + Math.floor(Math.random() * 6)))
  },
  {
    name: 'id', category: 'Tools', desc: 'Show this chat\'s ID and yours',
    run: ({ jid, sender, reply }) => reply(`Chat: ${jid}\nYou: ${sender}`)
  }
]
