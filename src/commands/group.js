import { digits, dropMeta } from '../utils.js'

/** People the command targets: @mentions first, otherwise the author of the replied-to message. */
function targets(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  return ctx?.mentionedJid?.length ? ctx.mentionedJid : ctx?.participant ? [ctx.participant] : []
}

const change = (action, past) => async ({ sock, msg, jid, reply }) => {
  const who = targets(msg)
  if (!who.length) return reply('Mention someone or reply to their message.')
  await sock.groupParticipantsUpdate(jid, who, action)
  dropMeta(jid)
  reply(`Done: ${past} ${who.map((j) => '@' + digits(j)).join(', ')}`, { mentions: who })
}

export default [
  {
    name: 'tagall', category: 'Group', desc: 'Mention everyone', admin: true,
    run: ({ sock, jid, meta, text, reply }) =>
      reply(`${text || 'Attention!'}\n\n` + meta.participants.map((p) => '@' + digits(p.id)).join(' '), { mentions: meta.participants.map((p) => p.id) })
  },
  {
    name: 'hidetag', category: 'Group', desc: 'Notify everyone without listing them', admin: true,
    run: ({ sock, jid, meta, text }) => sock.sendMessage(jid, { text: text || '👋', mentions: meta.participants.map((p) => p.id) })
  },
  { name: 'kick', category: 'Group', desc: 'Remove a member', admin: true, botAdmin: true, run: change('remove', 'removed') },
  { name: 'promote', category: 'Group', desc: 'Make a member admin', admin: true, botAdmin: true, run: change('promote', 'promoted') },
  { name: 'demote', category: 'Group', desc: 'Remove admin rights', admin: true, botAdmin: true, run: change('demote', 'demoted') },
  {
    name: 'link', category: 'Group', desc: 'Get the group invite link', admin: true, botAdmin: true,
    run: async ({ sock, jid, reply }) => reply('https://chat.whatsapp.com/' + (await sock.groupInviteCode(jid)))
  }
]
