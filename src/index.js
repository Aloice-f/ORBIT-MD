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
import { listSessions, restoreSession } from './session.js'
import * as store from './store.js'
import * as persist from './persist.js'
import { handle } from './handler.js'
import { guard, onParticipants } from './protection.js'
import { onStatus } from './status.js'
import { remember, onRevoke } from './antidelete.js'
import { textOf, putMeta, peekMeta } from './utils.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'error' })
const log = (what) => (e) => console.error(`${what} error:`, e?.message ?? e)

// 1. Find every session (one per WhatsApp number). With one session nothing changes from before;
//    with several, each gets its own folder and its own connection inside this one bot.
store.load()
const sessions = listSessions()
if (!sessions.length) {
  console.error('No valid session found. Set SESSION_ID (or SESSION_IDS) or paste your IDs into session/session.txt.')
  if (config.pairSite) console.error(`Get one at ${config.pairSite}`)
  process.exit(1)
}
const multi = sessions.length > 1
for (const s of sessions) s.dir = multi ? `${config.authDir}_${s.number}` : config.authDir

if (!multi) {
  // Supabase backup (optional) is only used for a single number.
  await persist.restore(sessions[0].number)
  persist.start()
} else {
  console.log(`Running ${sessions.length} numbers in one bot: ${sessions.map((s) => s.number).join(', ')}`)
  console.log('Note: every number uses memory (roughly 80-120 MB each). If the server restarts on its own, use a plan with more RAM or split the numbers across servers.')
}
for (const s of sessions) {
  if (!restoreSession(s.raw, s.dir)) { console.error(`Could not load the session for ${s.number}.`); process.exit(1) }
}
console.log(`Sessions ready. Prefix "${prefix()}", mode "${botState.mode}". Connecting...`)

// Some hosts (Render, Koyeb...) need something listening on $PORT. Panels simply ignore it.
if (process.env.PORT) http.createServer((_, res) => res.end('ok')).listen(config.port)

// Hosts send SIGTERM before restarting: save keys and settings first.
process.on('SIGTERM', async () => { await persist.flush(); process.exit(0) })
process.on('unhandledRejection', log('Unhandled rejection'))

const active = new Set(sessions.map((s) => s.number))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let waVersion

async function connect(session) {
  const { number, dir } = session
  const tag = multi ? `[${number}] ` : ''
  const { state, saveCreds } = await useMultiFileAuthState(dir)
  waVersion ??= (await fetchLatestBaileysVersion().catch(() => ({}))).version
  const sock = makeWASocket({
    version: waVersion,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    // Speed: skip downloading old chat history at login, and answer group lookups from our own cache.
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    cachedGroupMetadata: async (jid) => peekMeta(jid),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) }
  })

  sock.ev.on('creds.update', async () => { await saveCreds(); if (!multi) persist.backupAuthSoon() })
  sock.ev.on('call', async (calls) => {
    if (!store.get('anticall')) return
    for (const c of calls) {
      if (c.status !== 'offer') continue
      await sock.rejectCall(c.id, c.from).catch(() => {})
      await sock.sendMessage(c.from, { text: 'Calls are not accepted here. Please send a message instead.' }).catch(() => {})
    }
  })
  sock.ev.on('group-participants.update', (e) => onParticipants(sock, e).catch(log('Welcome')))
  sock.ev.on('groups.upsert', (gs) => gs.forEach((g) => putMeta(g.id, g)))
  sock.ev.on('groups.update', (us) => us.forEach((u) => { const cur = peekMeta(u.id); if (cur) putMeta(u.id, { ...cur, ...u }) }))

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Only real new messages. ('append' also carries the bot's own outgoing messages and history, which must never run commands.)
    if (type !== 'notify') return
    for (const m of messages) {
      if (!m.message || textOf(m).startsWith(prefix())) console.log(`${tag}Incoming ${m.key.id?.slice(0, 8)} (${type}) ${m.key.fromMe ? 'from me' : 'from ' + String(m.key.participant || m.key.remoteJid).split('@')[0]} in ${m.key.remoteJid.endsWith('@g.us') ? 'group' : m.key.remoteJid === 'status@broadcast' ? 'status' : 'chat'}${m.message ? '' : ' [no content - could not decrypt]'}`)
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

  let announced = false
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`${tag}${botName()} connected as ${sock.user.id.split(':')[0]}`)
      sock.groupFetchAllParticipating().then((all) => Object.values(all).forEach((g) => putMeta(g.id, g))).catch(() => {}) // fill the group cache in the background
      if (!announced) {
        announced = true
        sock
          .sendMessage(jidNormalizedUser(sock.user.id), { text: `✅ ${botName()} is online.\nSend ${prefix()}menu to see commands.` })
          .catch(() => {})
      }
    }
    if (connection !== 'close') return

    const code = lastDisconnect?.error?.output?.statusCode
    const stop = (why) => {
      active.delete(number)
      console.error(`${tag}${why}`)
      if (!active.size) process.exit(1)
    }
    if (code === DisconnectReason.loggedOut) {
      fs.rmSync(dir, { recursive: true, force: true })
      if (!multi) return persist.wipe().finally(() => stop('This session was logged out from the phone. Pair again to get a new SESSION_ID.'))
      return stop('This session was logged out from the phone. Pair again and replace its ID.')
    }
    if (code === DisconnectReason.connectionReplaced) return stop('The same session is connected somewhere else. Run it in one place only.')
    console.log(`${tag}Connection closed (${code ?? 'unknown'}), reconnecting...`)
    setTimeout(() => connect(session).catch(log(`${tag}Reconnect`)), 3000)
  })
}

for (const s of sessions) {
  await connect(s).catch((e) => {
    console.error(`${multi ? `[${s.number}] ` : ''}Fatal start error:`, e)
    active.delete(s.number)
    if (!active.size) process.exit(1)
  })
  if (multi) await sleep(3000) // start one at a time so the server is not hit by four logins at once
}