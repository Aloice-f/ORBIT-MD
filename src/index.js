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
import { config, prefix, botName, state as botState } from './config.js'
import { decodeSession, readRaw, restoreSession, sessionNumber } from './session.js'
import * as store from './store.js'
import * as persist from './persist.js'
import { handle } from './handler.js'
import { guard, onParticipants } from './protection.js'
import { onStatus } from './status.js'
import { remember, onRevoke } from './antidelete.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'error' })
const log = (what) => (e) => console.error(`${what} error:`, e?.message ?? e)

// 1. Work out which number this is, load settings, and pull newer keys from Supabase if it is set up.
let id
try {
  const raw = readRaw()
  if (raw.trim()) id = sessionNumber(decodeSession(raw))
} catch (e) {
  console.error('SESSION_ID is not valid:', e.message)
  process.exit(1)
}
store.load()
if (id) await persist.restore(id)

if (!restoreSession()) {
  console.error('No session found. Set SESSION_ID or paste it into session/session.txt.')
  if (config.pairSite) console.error(`Get one at ${config.pairSite}`)
  process.exit(1)
}
persist.start()
console.log(`Session found. Prefix "${prefix()}", mode "${botState.mode}". Connecting...`)

// Some hosts (Render, Koyeb...) need something listening on $PORT. Panels simply ignore it.
if (process.env.PORT) http.createServer((_, res) => res.end('ok')).listen(config.port)

// Hosts send SIGTERM before restarting: save keys and settings first.
process.on('SIGTERM', async () => { await persist.flush(); process.exit(0) })
process.on('unhandledRejection', log('Unhandled rejection'))

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

  sock.ev.on('creds.update', async () => { await saveCreds(); persist.backupAuthSoon() })
  sock.ev.on('call', async (calls) => {
    if (!store.get('anticall')) return
    for (const c of calls) {
      if (c.status !== 'offer') continue
      await sock.rejectCall(c.id, c.from).catch(() => {})
      await sock.sendMessage(c.from, { text: 'Calls are not accepted here. Please send a message instead.' }).catch(() => {})
    }
  })
  sock.ev.on('group-participants.update', (e) => onParticipants(sock, e).catch(log('Welcome')))

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // 'notify' = new messages. Messages you type on the linked phone can arrive as 'append', so let those through too.
    if (type !== 'notify' && type !== 'append') return
    for (const m of messages) {
      console.log(`Incoming (${type}) ${m.key.fromMe ? 'from me' : 'from ' + String(m.key.participant || m.key.remoteJid).split('@')[0]} in ${m.key.remoteJid.endsWith('@g.us') ? 'group' : m.key.remoteJid === 'status@broadcast' ? 'status' : 'chat'}${m.message ? '' : ' [no content - could not decrypt]'}`)
      if (type === 'append' && !(m.key.fromMe && Date.now() / 1000 - Number(m.messageTimestamp || 0) < 60)) continue
      if (m.key.remoteJid === 'status@broadcast') { onStatus(sock, m).catch(log('Status')); continue }
      if (!m.key.fromMe) {
        if (store.get('autoread')) sock.readMessages([m.key]).catch(() => {})
        if (store.get('autotyping')) sock.sendPresenceUpdate('composing', m.key.remoteJid).catch(() => {})
      }
      if (store.get('antidelete')) {
        remember(m)
        if (m.message?.protocolMessage) { onRevoke(sock, m).catch(log('Antidelete')); continue }
      }
      guard(sock, m).then((removed) => removed || handle(sock, m)).catch(log('Handler'))
    }
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`${botName()} connected as ${sock.user.id.split(':')[0]}`)
      if (!announced) {
        announced = true
        sock
          .sendMessage(jidNormalizedUser(sock.user.id), { text: `✅ ${botName()} is online.\nSend ${prefix()}menu to see commands.` })
          .catch(() => {})
      }
    }
    if (connection !== 'close') return

    const code = lastDisconnect?.error?.output?.statusCode
    if (code === DisconnectReason.loggedOut) {
      console.error('This session was logged out from the phone. Pair again to get a new SESSION_ID.')
      fs.rmSync(config.authDir, { recursive: true, force: true })
      persist.wipe().finally(() => process.exit(1))
      return
    }
    if (code === DisconnectReason.connectionReplaced) {
      console.error('The same session is connected somewhere else. Run it in one place only.')
      process.exit(1)
    }
    console.log(`Connection closed (${code ?? 'unknown'}), reconnecting...`)
    setTimeout(() => connect().catch(log('Reconnect')), 3000)
  })
}

connect().catch((e) => { console.error('Fatal start error:', e); process.exit(1) })
