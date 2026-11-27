import fs from 'node:fs'
import { config } from './config.js'

export const digits = (jid = '') => String(jid).split('@')[0].split(':')[0]

export function textOf(m) {
  const x = m.message
  if (!x) return ''
  const c = x.ephemeralMessage?.message ?? x
  return c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? ''
}

/** The message this one replies to, shaped for downloading: { key, message } or null. */
export function quotedOf(msg, jid) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  if (!ctx?.quotedMessage) return null
  return { key: { remoteJid: ctx.remoteJid || jid, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage }
}

// Group info is cached for a minute so busy groups do not hammer WhatsApp.
const cache = new Map()
export async function getMeta(sock, jid) {
  const hit = cache.get(jid)
  if (hit && Date.now() - hit.t < 60_000) return hit.meta
  const meta = await sock.groupMetadata(jid)
  cache.set(jid, { meta, t: Date.now() })
  return meta
}
export const dropMeta = (jid) => cache.delete(jid)
/** Store group info we already have (from WhatsApp events or a bulk fetch). */
export const putMeta = (jid, meta) => cache.set(jid, { meta, t: Date.now() })
/** Cached group info for Baileys, so sending to a group does not need a lookup first. Kept in step by group events. */
export const peekMeta = (jid) => { const hit = cache.get(jid); return hit && Date.now() - hit.t < 600_000 ? hit.meta : undefined }

export const isAdminIn = (meta, jid) =>
  meta.participants.some((p) => p.admin && [p.id, p.jid].some((x) => x && digits(x) === digits(jid)))

const BANNER = new URL('../assets/menu.jpg', import.meta.url)
let bannerBuf
/** Send a picture with a caption (assets/menu.jpg, or MENU_IMAGE_URL). Falls back to plain text. */
export async function sendBanner(sock, jid, caption, options = {}) {
  try {
    const image = config.menuImage ? { url: config.menuImage } : (bannerBuf ??= fs.readFileSync(BANNER))
    return await sock.sendMessage(jid, { image, caption }, options)
  } catch (e) {
    console.error('Banner failed, sending text only:', e.message)
    return sock.sendMessage(jid, { text: caption }, options)
  }
}

/** Who a command points at: @mention, replied-to author, or a number typed as the argument. */
export function targetOf(msg, arg = '') {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  const n = String(arg).replace(/\D/g, '')
  return ctx?.mentionedJid?.[0] || ctx?.participant || (n.length >= 8 ? n + '@s.whatsapp.net' : null)
}