import { quotedOf } from '../utils.js'

const pick = (a) => a[Math.floor(Math.random() * a.length)]

const TRUTH = [
  'What is your biggest fear?',
  'What is the most embarrassing thing you have done?',
  'Who was your first crush?',
  'What is a secret you have never told anyone here?',
  'What is the weirdest dream you remember?'
]
const DARE = [
  'Send the last photo in your gallery.',
  'Text your crush "I have a secret to tell you".',
  'Speak in an accent for the next 5 messages.',
  'Let the group pick your WhatsApp status for a day.',
  'Send a voice note singing a song of the group\'s choice.'
]

export default [
  {
    name: 'joke', aliases: ['jokes'], category: 'Fun', desc: 'Get a random joke',
    run: async ({ reply }) => {
      const r = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode', { signal: AbortSignal.timeout(15_000) })
      const d = await r.json()
      reply(d.type === 'twopart' ? `${d.setup}\n\n${d.delivery}` : (d.joke || 'Could not think of one, try again.'))
    }
  },
  {
    name: 'quote', aliases: ['qotd'], category: 'Fun', desc: 'Get an inspirational quote',
    run: async ({ reply }) => {
      const r = await fetch('https://api.quotable.io/random', { signal: AbortSignal.timeout(15_000) })
      const d = await r.json()
      reply(d.content ? `"${d.content}"\n— ${d.author}` : 'Could not fetch a quote right now.')
    }
  },
  {
    name: 'fact', aliases: ['didyouknow'], category: 'Fun', desc: 'Get a random fact',
    run: async ({ reply }) => {
      const r = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { signal: AbortSignal.timeout(15_000) })
      const d = await r.json()
      reply(d.text || 'Could not fetch a fact right now.')
    }
  },
  {
    name: 'truth', category: 'Fun', desc: 'Get a random truth question',
    run: ({ reply }) => reply(`🤔 Truth: ${pick(TRUTH)}`)
  },
  {
    name: 'dare', category: 'Fun', desc: 'Get a random dare',
    run: ({ reply }) => reply(`🔥 Dare: ${pick(DARE)}`)
  },
  {
    name: 'reverse', category: 'Tools', desc: 'Reverse the given text',
    run: ({ text, reply }) => reply(text ? [...text].reverse().join('') : 'Give me some text, e.g. .reverse hello')
  },
  {
    name: 'count', aliases: ['wordcount'], category: 'Tools', desc: 'Count words and characters in text',
    run: ({ text, reply }) => {
      if (!text) return reply('Give me some text, e.g. .count hello world')
      const words = text.trim().split(/\s+/).filter(Boolean).length
      reply(`Words: ${words}\nCharacters: ${text.length}`)
    }
  },
  {
    name: 'qr', aliases: ['qrcode'], category: 'Tools', desc: 'Make a QR code from text or a link',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!text) return reply('Give me text or a link, e.g. .qr https://example.com')
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`
      await sock.sendMessage(jid, { image: { url }, caption: `QR code for: ${text}` }, { quoted: msg })
    }
  },
  {
    name: 'shorten', aliases: ['short'], category: 'Tools', desc: 'Shorten a long link',
    run: async ({ text, reply }) => {
      if (!/^https?:\/\//.test(text || '')) return reply('Send a link, e.g. .shorten https://example.com/very/long/path')
      const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(15_000) })
      const short = await r.text()
      reply(/^https?:\/\//.test(short) ? short : 'Could not shorten that link right now.')
    }
  },
  {
    name: 'quoted', aliases: ['qmsg'], category: 'Tools', desc: 'Show the text of the message you replied to',
    run: ({ msg, jid, reply }) => {
      const q = quotedOf(msg, jid)
      const t = q?.message?.conversation || q?.message?.extendedTextMessage?.text || q?.message?.imageMessage?.caption
      reply(t || 'Reply to a text message with .quoted')
    }
  }
]
