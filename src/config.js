import 'dotenv/config'
import * as store from './store.js'

const digits = (v = '') => v.split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean)

export const config = {
  botName: process.env.BOT_NAME || 'Orbit-MD',
  ownerName: process.env.OWNER_NAME || 'Owner',
  menuImage: process.env.MENU_IMAGE_URL || '',
  prefix: process.env.PREFIX || '.',
  owners: digits(process.env.OWNER_NUMBER),
  port: Number(process.env.PORT) || 3000,
  authDir: process.env.AUTH_DIR || 'auth',
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  pairSite: process.env.PAIR_SITE_URL || '',
  maxPairings: Number(process.env.MAX_PAIRINGS) || 10
}

// Runtime state. `.mode` changes it until restart; set MODE in the environment to make it permanent.
export const state = { mode: (process.env.MODE || 'public').toLowerCase() }

// Prefix and bot name can be changed from WhatsApp (.setprefix / .setbotname) and are saved in settings.
export const prefix = () => store.get('prefix') || config.prefix
export const botName = () => store.get('botName') || config.botName
