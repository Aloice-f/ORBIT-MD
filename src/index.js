import http from 'node:http'
import fs from 'node:fs'
import pino from 'pino'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import { config } from './config.js'
import { restoreSession } from './session.js'
import { handle } from './handler.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' })

let ok = false
try {
  ok = restoreSession()
} catch (e) {
  console.error('SESSION_ID is not valid:', e.message)
}
if (!ok) {
  console.error('No session found. Set SESSION_ID (or create session.txt).')
  if (config.pairSite) console.error(`Get one at ${config.pairSite}`)
  process.exit(1)
}

// Some hosts (Render, Koyeb...) need something listening on $PORT. Panels simply ignore it.
if (process.env.PORT) http.createServer((_, res) => res.end('ok')).listen(config.port)

let announced = false

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}))
  const sock = makeWASocket({
    version,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) handle(sock, m).catch((e) => console.error('Handler error:', e.message))
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`${config.botName} connected as ${sock.user.id.split(':')[0]}`)
      if (!announced) {
        announced = true
        sock
          .sendMessage(jidNormalizedUser(sock.user.id), { text: `✅ ${config.botName} is online.\nSend ${config.prefix}menu to see commands.` })
          .catch(() => {})
      }
    }
    if (connection !== 'close') return

    const code = lastDisconnect?.error?.output?.statusCode
    if (code === DisconnectReason.loggedOut) {
      console.error('This session was logged out from the phone. Pair again to get a new SESSION_ID.')
      fs.rmSync(config.authDir, { recursive: true, force: true })
      process.exit(1)
    }
    if (code === DisconnectReason.connectionReplaced) {
      console.error('The same session is connected somewhere else. Run it in one place only.')
      process.exit(1)
    }
    console.log(`Connection closed (${code ?? 'unknown'}), reconnecting...`)
    setTimeout(() => connect().catch((e) => console.error('Reconnect failed:', e.message)), 3000)
  })
}

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e?.message ?? e))
connect().catch((e) => { console.error('Fatal start error:', e); process.exit(1) })
