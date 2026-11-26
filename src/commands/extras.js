import pino from 'pino'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { config } from '../config.js'
import { quotedOf } from '../utils.js'

const logger = pino({ level: 'silent' })
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
    name: 'play', category: 'Download', desc: 'Send a song from YouTube: .play <name or link>',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!text) return reply('Which song? e.g. .play burna boy last last')
      const url = /^https?:\/\//.test(text) ? text : (await firstVideo(text))?.url
      if (!url) return reply('I could not find that song.')
      const ytdl = (await import('@distube/ytdl-core')).default
      const info = await ytdl.getInfo(url)
      if (Number(info.videoDetails.lengthSeconds) > 900) return reply('That is longer than 15 minutes. Pick something shorter.')
      await reply(`Downloading: ${info.videoDetails.title}`)
      let format
      try { format = ytdl.chooseFormat(info.formats, { quality: '140' }) } catch { format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' }) }
      const chunks = []
      for await (const c of ytdl.downloadFromInfo(info, { format })) chunks.push(c)
      await sock.sendMessage(jid, { audio: Buffer.concat(chunks), mimetype: 'audio/mp4', fileName: info.videoDetails.title + '.m4a' }, { quoted: msg })
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
