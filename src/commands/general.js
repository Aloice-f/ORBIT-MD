import { config, botName } from '../config.js'

const pick = (a) => a[Math.floor(Math.random() * a.length)]
const BALL = ['Yes.', 'No.', 'Maybe.', 'Definitely.', 'Not a chance.', 'Ask again later.', 'Looks good.', 'Very doubtful.']

export default [
  {
    name: 'ping', category: 'General', desc: 'Check the bot is responding',
    run: ({ reply }) => reply('Pong!')
  },
  {
    name: 'alive', category: 'General', desc: 'Uptime and status',
    run: ({ reply }) => {
      const s = Math.floor(process.uptime())
      reply(`✅ ${botName()} is online\nUptime: ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`)
    }
  },
  {
    name: 'time', category: 'General', desc: 'Current time',
    run: ({ reply }) => reply(new Date().toLocaleString('en-GB', { timeZone: config.timezone, dateStyle: 'full', timeStyle: 'medium' }))
  },
  {
    name: 'say', category: 'Fun', desc: 'Make the bot repeat text',
    run: ({ text, reply }) => reply(text || 'Say what?')
  },
  {
    name: 'flip', category: 'Fun', desc: 'Flip a coin',
    run: ({ reply }) => reply(pick(['Heads', 'Tails']))
  },
  {
    name: '8ball', category: 'Fun', desc: 'Ask the magic 8-ball',
    run: ({ text, reply }) => reply(text ? pick(BALL) : 'Ask a question first.')
  },
  {
    name: 'calc', category: 'Tools', desc: 'Calculate, e.g. .calc 12*(3+4)',
    run: ({ text, reply }) => {
      if (!/^[\d+\-*/().%\s]+$/.test(text)) return reply('Use numbers and + - * / ( ) % only.')
      try { reply(String(Function(`"use strict"; return (${text})`)())) } catch { reply('That expression is not valid.') }
    }
  }
]
