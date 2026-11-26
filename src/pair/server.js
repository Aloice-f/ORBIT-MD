import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import pino from 'pino'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import { config } from '../config.js'
import { encodeSession } from '../session.js'

const logger = pino({ level: 'silent' })
const PAGE = new URL('../../public/index.html', import.meta.url)
const FILES = {
  '/song': [new URL('../../public/song.mp3', import.meta.url), 'audio/mpeg'],
  '/assets/menu.jpg': [new URL('../../assets/menu.jpg', import.meta.url), 'image/jpeg']
}

/** Static file with Range support (Safari needs it for audio). */
function sendFile(req, res, [url, type]) {
  if (!fs.existsSync(url)) return res.writeHead(404).end()
  const size = fs.statSync(url).size
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  let start = 0, end = size - 1, code = 200
  if (m) {
    start = m[1] ? Number(m[1]) : 0
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start > end) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
    code = 206
  }
  res.writeHead(code, {
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'public, max-age=86400',
    ...(code === 206 && { 'Content-Range': `bytes ${start}-${end}/${size}` })
  })
  fs.createReadStream(url, { start, end }).pipe(res)
}

const LIFETIME = 3 * 60_000 // a pairing attempt is dropped after 3 minutes
const KEEP = 5 * 60_000 // a finished session ID stays fetchable for 5 minutes, then is forgotten

// Nothing is written to a database. Each attempt uses a temp folder that is deleted when it ends.
const jobs = new Map()

const fmt = (c) => c.match(/.{1,4}/g)?.join('-') ?? c

function cleanNumber(input) {
  const n = String(input ?? '').replace(/[\s\-().+]/g, '')
  if (!/^\d+$/.test(n)) return { error: 'Use digits only, for example 254712345678.' }
  if (n.startsWith('0')) return { error: 'Start with your country code instead of 0. Kenya example: 254712345678.' }
  if (n.length < 8 || n.length > 15) return { error: 'That number looks the wrong length. Include the country code.' }
  return { number: n }
}

function end(job, patch) {
  if (job.done) return
  job.done = true
  Object.assign(job, patch)
  clearTimeout(job.timeout)
  try { job.sock?.end(undefined) } catch {}
  fs.rmSync(job.dir, { recursive: true, force: true })
  setTimeout(() => jobs.delete(job.id), KEEP)
}

/** Open a temporary WhatsApp connection and resolve as soon as WhatsApp has issued the pairing code. */
async function startPairing(number) {
  const job = { id: crypto.randomBytes(12).toString('hex'), status: 'starting', code: null, sessionId: null, error: null, done: false }
  job.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-'))
  jobs.set(job.id, job)
  job.timeout = setTimeout(() => end(job, { status: 'expired', error: 'The code expired. Request a new one.' }), LIFETIME)

  const { version } = await fetchLatestBaileysVersion().catch(() => ({}))
  let gotCode
  const codeReady = new Promise((resolve, reject) => (gotCode = { resolve, reject }))

  const connect = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(job.dir)
    const sock = makeWASocket({
      version,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) }
    })
    job.sock = sock
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (job.done) return

      // WhatsApp emits a QR when it is ready; that is the moment a pairing code can be requested.
      if (qr && !sock.authState.creds.registered && !job.code) {
        try {
          job.code = await sock.requestPairingCode(number)
          job.status = 'waiting'
          gotCode.resolve()
        } catch (e) {
          gotCode.reject(e)
          end(job, { status: 'error', error: 'WhatsApp refused the request. Check the number and try again.' })
        }
      }

      if (connection === 'open') {
        try {
          await saveCreds()
          const sessionId = encodeSession(fs.readFileSync(path.join(job.dir, 'creds.json'), 'utf8'))
          job.status = 'linked'
          job.sessionId = sessionId
          // Also drop it in the user's own WhatsApp chat, so it is not lost if the tab closes.
          await sock
            .sendMessage(jidNormalizedUser(sock.user.id), {
              text: `✅ ${config.botName} linked.\n\nYour SESSION ID is below. Treat it like a password: anyone who has it controls this WhatsApp account.\n\n${sessionId}`
            })
            .catch(() => {})
          await new Promise((r) => setTimeout(r, 1500))
          end(job, {}) // closes the socket without logging out, so the session stays valid for the bot
        } catch (e) {
          end(job, { status: 'error', error: 'Linked, but the session could not be built. Try again.' })
        }
      }

      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode
        // WhatsApp always restarts the connection once right after a successful link.
        if (status === DisconnectReason.restartRequired) return connect()
        if (!job.code) gotCode.reject(new Error('closed'))
        end(job, { status: 'error', error: 'The connection to WhatsApp closed. Try again.' })
      }
    })
  }

  await connect()
  await Promise.race([codeReady, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25_000))]).catch((e) => {
    end(job, { status: 'error', error: 'WhatsApp took too long to answer. Try again.' })
    throw e
  })
  job.status = 'waiting'
  return job
}

// ---- tiny HTTP layer -------------------------------------------------------------------------
const hits = new Map()
function limited(ip, max = 6) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > max
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 2048) { reject(new Error('Request too large')); req.destroy() }
    })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('Invalid request')) } })
  })

const send = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

http
  .createServer(async (req, res) => {
    const url = req.url.split('?')[0]
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()

    if (url === '/health') return send(res, 200, { ok: true, uptime: Math.floor(process.uptime()), active: [...jobs.values()].filter((j) => !j.done).length })

    if (req.method === 'GET' && FILES[url]) return sendFile(req, res, FILES[url])

    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
      })
      return res.end(fs.readFileSync(PAGE, 'utf8').replaceAll('{{BOT_NAME}}', config.botName.toUpperCase().replace(/[<>&"]/g, '')).replaceAll('{{BOT_INITIAL}}', config.botName.charAt(0).toUpperCase().replace(/[<>&"]/g, '')))
    }

    if (req.method === 'POST' && url === '/api/pair') {
      try {
        if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' })
        const { number, error } = cleanNumber((await readJson(req)).number)
        if (error) return send(res, 400, { error })
        if ([...jobs.values()].filter((j) => !j.done).length >= config.maxPairings) {
          return send(res, 503, { error: 'The pairing service is busy. Try again in a minute.' })
        }
        const job = await startPairing(number)
        return send(res, 200, { id: job.id, code: fmt(job.code), expiresIn: 120 })
      } catch (e) {
        return send(res, 502, { error: 'Could not get a code from WhatsApp. Try again.' })
      }
    }

    const m = url.match(/^\/api\/pair\/([a-f0-9]{24})$/)
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1])
      if (!job) return send(res, 404, { status: 'expired', error: 'This attempt is no longer available.' })
      return send(res, 200, { status: job.status, error: job.error, ...(job.sessionId ? { sessionId: job.sessionId } : {}) })
    }

    res.writeHead(404).end()
  })
  .listen(config.port, () => console.log(`Pairing site on :${config.port}`))

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e?.message ?? e))
