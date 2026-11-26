import fs from 'node:fs'
import path from 'node:path'

// Settings live in one JSON file. persist.js can mirror it to Supabase so it survives restarts on hosts with no disk.
const FILE = path.join(process.env.DATA_DIR || 'data', 'settings.json')
const fresh = () => ({ global: { autoviewstatus: false, autolikestatus: false, statusEmoji: '💚', antidelete: false, autoread: false, autotyping: false, anticall: false, prefix: '', botName: '', sudo: [] }, groups: {} })
let data = fresh()
let listener = () => {}

function write() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('Could not save settings:', e.message)
  }
  listener(data)
}

export function load() {
  try {
    if (fs.existsSync(FILE)) data = { ...fresh(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
  } catch (e) {
    console.error('Could not read settings, using defaults:', e.message)
  }
}
export function replace(obj) { data = { ...fresh(), ...obj }; write() }
export const onSave = (fn) => { listener = fn }
export const all = () => data

export const get = (k) => data.global[k]
export function set(k, v) { data.global[k] = v; write() }
export const group = (jid) => data.groups[jid] ?? {}
export function setGroup(jid, k, v) { (data.groups[jid] ??= {})[k] = v; write() }
