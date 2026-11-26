import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
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
// Different ytdl-core releases export themselves differently (default export, named exports, or nested default).
// This finds the object that actually has getInfo, so a version change never breaks the import.
async function loadYtdl() {
  const mod = await import('@distube/ytdl-core')
  for (const c of [mod.default, mod.default?.default, mod]) if (typeof c?.getInfo === 'function') return c
  throw new Error('ytdl-core loaded but has no getInfo (exports: ' + Object.keys(mod).join(', ') + ')')
}

let ytAgent
function getAgent(ytdl) {
  if (ytAgent !== undefined) return ytAgent
  ytAgent = null
  try {
    const raw = process.env.YT_COOKIES || (fs.existsSync('cookies.json') ? fs.readFileSync('cookies.json', 'utf8') : '')
    if (raw.trim() && typeof ytdl.createAgent === 'function') ytAgent = ytdl.createAgent(JSON.parse(raw))
  } catch (e) {
    console.error('YouTube cookies ignored (bad JSON?):', e.message)
  }
  return ytAgent
}

async function ytMedia(url, pickFormat) {
  const ytdl = await loadYtdl()
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

// ---- yt-dlp: the main YouTube downloader (far better maintained than ytdl-core) -------------------------
// The standalone Linux binary is fetched once into ./bin on first use, so nothing extra has to be installed.
// Optional: YTDLP_PATH (use your own binary), YTDLP_URL (different download), cookies.txt (Netscape format) beside package.json.
const YTDLP_BIN = path.resolve('bin', 'yt-dlp')
let ytdlpReady
function ensureYtdlp() {
  ytdlpReady ??= (async () => {
    if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH
    if (fs.existsSync(YTDLP_BIN)) return YTDLP_BIN
    const file = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
    const url = process.env.YTDLP_URL || `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${file}`
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })
    if (!r.ok) throw new Error(`could not download yt-dlp (HTTP ${r.status})`)
    fs.mkdirSync(path.dirname(YTDLP_BIN), { recursive: true })
    fs.writeFileSync(YTDLP_BIN + '.part', Buffer.from(await r.arrayBuffer()))
    fs.chmodSync(YTDLP_BIN + '.part', 0o755)
    fs.renameSync(YTDLP_BIN + '.part', YTDLP_BIN)
    return YTDLP_BIN
  })().catch((e) => { ytdlpReady = undefined; throw e })
  return ytdlpReady
}

function execBuf(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'buffer', maxBuffer: 90 * 1024 * 1024, timeout: 150_000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout)
      const lines = stderr.toString().split('\n').map((l) => l.trim()).filter(Boolean)
      reject(new Error((lines.reverse().find((l) => /error/i.test(l)) || lines[0] || err.message).replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, '')))
    })
  })
}

async function ytdlp(args) {
  const bin = await ensureYtdlp()
  const base = ['--no-playlist', '--no-warnings', '--no-progress']
  if (fs.existsSync('cookies.txt')) base.push('--cookies', 'cookies.txt')
  if (process.env.YT_PROXY) base.push('--proxy', process.env.YT_PROXY)
  try {
    return await execBuf(bin, [...base, '--js-runtimes', 'node', ...args]) // newer yt-dlp uses node to solve YouTube's player checks
  } catch (e) {
    if (!/no such option|unrecognized arguments/i.test(e.message)) throw e
    return execBuf(bin, [...base, ...args]) // older yt-dlp without that flag
  }
}

/** { title, seconds } for a link (a search result already has these). */
async function ytInfoFor(url) {
  const out = (await ytdlp(['--skip-download', '--print', '%(duration)s|%(title)s', url])).toString().trim().split('\n')[0]
  const [seconds, ...t] = out.split('|')
  return { title: t.join('|') || 'YouTube', seconds: Number(seconds) || 0 }
}

const YT_FORMATS = {
  audio: ['-f', 'bestaudio[ext=m4a]/140', '--max-filesize', '40M'],
  video: ['-f', '18/best[ext=mp4][height<=480]/best[ext=mp4]', '--max-filesize', '60M']
}
const ytdlpDownload = (url, kind) => ytdlp([...YT_FORMATS[kind], '-o', '-', url])

/** yt-dlp first, then ytdl-core, then (for song names only) SoundCloud. Returns { data, mime }. Throws a readable message if all fail. */
async function fetchYoutube(url, kind, query) {
  const mime = kind === 'audio' ? 'audio/mp4' : 'video/mp4'
  let first
  try {
    const data = await ytdlpDownload(url, kind)
    if (data.length) return { data, mime }
    first = new Error('YouTube returned an empty file')
  } catch (e) {
    first = e
    console.error('yt-dlp failed:', e.message)
  }
  try {
    const media = await ytMedia(url, kind === 'audio'
      ? (ytdl, info) => { try { return ytdl.chooseFormat(info.formats, { quality: '140' }) } catch { return ytdl.chooseFormat(info.formats, { quality: 'highestaudio' }) } }
      : (ytdl, info) => { try { return ytdl.chooseFormat(info.formats, { quality: '18' }) } catch { return ytdl.chooseFormat(info.formats, { quality: 'lowest', filter: 'audioandvideo' }) } })
    return { data: await ytDownload(media), mime }
  } catch (e2) {
    console.error('ytdl-core fallback failed:', e2.message)
  }
  if (kind === 'audio' && query) {
    try {
      // SoundCloud does not block hosting IPs the way YouTube does. mp3 only, so the file type is known.
      const data = await ytdlp(['-f', 'bestaudio[ext=mp3]', '--max-filesize', '40M', '-o', '-', `scsearch1:${query}`])
      if (data.length) return { data, mime: 'audio/mpeg' }
    } catch (e3) {
      console.error('SoundCloud fallback failed:', e3.message)
    }
  }
  throw new Error(explainYoutube(first))
}

function explainYoutube(e) {
  const m = e?.message || String(e)
  if (/Sign in to confirm|not a bot|cookies/i.test(m)) return 'YouTube is blocking this server as a bot. Add a cookies.txt (exported from a logged-in browser) next to package.json, or try again later.'
  if (/could not download yt-dlp|ENOTFOUND|fetch failed|EACCES|ENOENT|spawn/i.test(m)) return `The yt-dlp downloader could not start (${m}). Check the host has internet access and allows running files from the bot folder.`
  if (/unavailable|private|removed|not available/i.test(m)) return 'That video is unavailable (private, removed or blocked in this region). Try another.'
  if (/larger than|max-filesize|filesize/i.test(m)) return 'That file is too large to send. Pick something shorter.'
  return m
}

async function pickVideo(text) {
  if (/^https?:\/\//.test(text)) return { url: text, ...(await ytInfoFor(text)) }
  const v = await firstVideo(text)
  return v && { url: v.url, title: v.title, seconds: v.seconds }
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
        const v = await pickVideo(text)
        if (!v) return reply('I could not find that song.')
        if (v.seconds > 900) return reply('That is longer than 15 minutes. Pick something shorter.')
        await reply(`Downloading: ${v.title}`)
        const { data, mime } = await fetchYoutube(v.url, 'audio', /^https?:\/\//.test(text) ? null : text)
        await sock.sendMessage(jid, { audio: data, mimetype: mime, fileName: v.title + (mime === 'audio/mpeg' ? '.mp3' : '.m4a') }, { quoted: msg })
      } catch (e) {
        console.error('play failed:', e)
        throw new Error(explainYoutube(e))
      }
    }
  },
  {
    name: 'video', aliases: ['mp4', 'ytv'], category: 'Download', desc: 'Send a video from YouTube: .video <name or link>',
    run: async ({ sock, jid, msg, text, reply }) => {
      if (!text) return reply('Which video? e.g. .video funny cat compilation')
      try {
        const v = await pickVideo(text)
        if (!v) return reply('I could not find that video.')
        if (v.seconds > 600) return reply('That is longer than 10 minutes. Pick something shorter so the file stays a reasonable size.')
        await reply(`Downloading: ${v.title}`)
        const { data } = await fetchYoutube(v.url, 'video')
        await sock.sendMessage(jid, { video: data, mimetype: 'video/mp4', caption: v.title }, { quoted: msg })
      } catch (e) {
        console.error('video failed:', e)
        throw new Error(explainYoutube(e))
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