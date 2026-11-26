import fs from 'node:fs'
import pino from 'pino'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { config } from '../config.js'
import { quotedOf } from '../utils.js'

const logger = pino({ level: 'silent' })
process.env.YTDL_NO_UPDATE ??= '1' // skip ytdl-core's own update check; it only adds delay and console noise
const AI = process.env.AI_BASE_URL || 'https://text.pollinations.ai'
const IMG = process.env.AI_IMAGE_URL || 'https://image.pollinations.ai/prompt'

async function ask(prompt) {
  const r = await fetch(`${AI}/${encodeURIComponent(prompt)}?model=openai`, { signal: AbortSignal.timeout(45_000) })
  if (!r.ok) throw new Error(`AI service answered ${r.status}`)
  return (await r.text()).trim()
}

// Heavy libraries are loaded only when a command needs them, so a missing one never stops the bot.
async function firstVideo(query) {
  const yts = (await import('yt-search')).default
  const { videos } = await yts(query)
  return videos[0]
}

// @distube/ytdl-core breaks whenever YouTube changes its player internals, and the raw error it
// throws is rarely self-explanatory. This maps the common cases to a plain-English cause so the
// reply in WhatsApp actually tells you what to do, instead of a bare error message.
function explainYtdlError(e) {
  const m = e?.message || String(e)
  if (/Could not extract functions|Could not parse decipher|n transform/i.test(m))
    return 'YouTube changed something on their end and the ytdl-core library has not caught up yet. Update the library (`npm install @distube/ytdl-core@latest`) and restart.'
  if (/Sign in to confirm|bot/i.test(m))
    return 'YouTube is blocking this as a bot/age/region check. The host IP is being blocked. Add YouTube cookies (YT_COOKIES variable or cookies.json) or try a different video.'
  if (/410|403|Status code/i.test(m))
    return 'YouTube rejected the download request (blocked IP or stale library version). Try `npm install @distube/ytdl-core@latest` first.'
  if (/No such format found|format/i.test(m))
    return 'That video has no audio/video format ytdl-core recognizes. Try a different video.'
  return m
}


// YouTube blocks many hosting IPs and changes its player often, so a single attempt fails a lot.
// This tries several "player clients" in turn and stops at the first one that returns a usable format.
// Optional: put exported YouTube cookies (JSON array) in the YT_COOKIES variable or a cookies.json file
// next to package.json. That fixes the "Sign in to confirm you're not a bot" block on most hosts.
let ytAgent
function getAgent(ytdl) {
  if (ytAgent !== undefined) return ytAgent
  ytAgent = null
  try {
    const raw = process.env.YT_COOKIES || (fs.existsSync('cookies.json') ? fs.readFileSync('cookies.json', 'utf8') : '')
    if (raw.trim()) ytAgent = ytdl.createAgent(JSON.parse(raw))
  } catch (e) {
    console.error('YouTube cookies ignored (bad JSON?):', e.message)
  }
  return ytAgent
}

async function ytMedia(url, pickFormat) {
  const ytdl = (await import('@distube/ytdl-core')).default
  const agent = getAgent(ytdl)
  let lastErr
  for (const playerClients of [undefined, ['IOS', 'ANDROID'], ['TV'], ['WEB_EMBEDDED']]) {
    try {
      const opts = {}
      if (agent) opts.agent = agent
      if (playerClients) opts.playerClients = playerClients
      const info = await ytdl.getInfo(url, opts)
      const format = pickFormat(ytdl, info)
      return { ytdl, info, format, agent }
    } catch (e) {
      lastErr = e
      console.error(`YouTube attempt (${playerClients?.join('+') || 'default'}) failed:`, e.message)
    }
  }
  throw lastErr || new Error('No usable format found')
}

async function ytDownload({ ytdl, info, format, agent }) {
  const chunks = []
  for await (const c of ytdl.downloadFromInfo(info, agent ? { format, agent } : { format })) chunks.push(c)
  return Buffer.concat(chunks)
}

export default [
  {
    name: 'ai', aliases: ['gpt', 'ask'], category: 'AI', desc: 'Ask the AI anything',
    run: async ({ text, reply }) => reply(text ? await ask(text) : 'Ask something, e.g. .ai explain gravity simply')
  },
  {
    name: 'imagine', aliases: ['img'], category: 'AI', desc: 'Generate an image from a prompt',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!text) return reply('Describe the image, e.g. .imagine a lion wearing a crown')
      await sock.sendMessage(jid, { image: { url: `${IMG}/${encodeURIComponent(text)}?width=768&height=768&nologo=true` }, caption: text }, { quoted: msg })
    }
  },
  {
    name: 'sticker', aliases: ['s'], category: 'Media', desc: 'Reply to an image or short video to make a sticker',
    run: async ({ sock, msg, jid, reply }) => {
      const target = quotedOf(msg, jid) ?? msg
      if (!target.message?.imageMessage && !target.message?.videoMessage) return reply('Reply to an image or short video with .sticker')
      const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })
      const { Sticker, StickerTypes } = await import('wa-sticker-formatter')
      const sticker = new Sticker(buffer, { pack: config.botName, author: 'Orbit', type: StickerTypes.FULL, quality: 60 })
      await sock.sendMessage(jid, await sticker.toMessage(), { quoted: msg })
    }
  },
  {
    name: 'yts', category: 'Download', desc: 'Search YouTube',
    run: async ({ text, reply }) => {
      if (!text) return reply('Search for what? e.g. .yts afrobeats mix')
      const yts = (await import('yt-search')).default
      const { videos } = await yts(text)
      reply(videos.slice(0, 5).map((v, i) => `${i + 1}. ${v.title} (${v.timestamp})\n${v.url}`).join('\n\n') || 'No results.')
    }
  },
  {
    name: 'play', aliases: ['song'], category: 'Download', desc: 'Send a song from YouTube: .play <name or link>',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!text) return reply('Which song? e.g. .play burna boy last last')
      try {
        const url = /^https?:\/\//.test(text) ? text : (await firstVideo(text))?.url
        if (!url) return reply('I could not find that song.')
        const media = await ytMedia(url, (ytdl, info) => {
          try { return ytdl.chooseFormat(info.formats, { quality: '140' }) } catch { return ytdl.chooseFormat(info.formats, { quality: 'highestaudio' }) }
        })
        const { title, lengthSeconds } = media.info.videoDetails
        if (Number(lengthSeconds) > 900) return reply('That is longer than 15 minutes. Pick something shorter.')
        await reply(`Downloading: ${title}`)
        const audio = await ytDownload(media)
        await sock.sendMessage(jid, { audio, mimetype: 'audio/mp4', fileName: title + '.m4a' }, { quoted: msg })
      } catch (e) {
        console.error('play failed:', e)
        throw new Error(explainYtdlError(e))
      }
    }
  },
  {
    name: 'video', aliases: ['mp4', 'ytv'], category: 'Download', desc: 'Send a video from YouTube: .video <name or link>',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!text) return reply('Which video? e.g. .video funny cat compilation')
      try {
        const url = /^https?:\/\//.test(text) ? text : (await firstVideo(text))?.url
        if (!url) return reply('I could not find that video.')
        const media = await ytMedia(url, (ytdl, info) => {
          try { return ytdl.chooseFormat(info.formats, { quality: '18' }) } catch { return ytdl.chooseFormat(info.formats, { quality: 'lowest', filter: 'audioandvideo' }) }
        })
        const { title, lengthSeconds } = media.info.videoDetails
        if (Number(lengthSeconds) > 600) return reply('That is longer than 10 minutes. Pick something shorter so the file stays a reasonable size.')
        await reply(`Downloading: ${title}`)
        const video = await ytDownload(media)
        await sock.sendMessage(jid, { video, mimetype: 'video/mp4', caption: title }, { quoted: msg })
      } catch (e) {
        console.error('video failed:', e)
        throw new Error(explainYtdlError(e))
      }
    }
  },
  {
    name: 'tiktok', aliases: ['tt'], category: 'Download', desc: 'Download a TikTok video without watermark',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!/^https?:\/\//.test(text)) return reply('Send a TikTok link, e.g. .tiktok https://vm.tiktok.com/...')
      const r = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(30_000) })
      const d = (await r.json())?.data
      if (!d?.play) return reply('I could not download that video.')
      await sock.sendMessage(jid, { video: { url: d.play }, caption: d.title || '' }, { quoted: msg })
    }
  }
]
