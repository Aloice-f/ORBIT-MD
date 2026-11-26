import general from './general.js'
import group from './group.js'
import protect from './protect.js'
import status from './status.js'
import extras from './extras.js'
import features from './features.js'
import menu from './menu.js'
import owner from './owner.js'

export const commands = [...general, ...menu, ...group, ...protect, ...status, ...features, ...extras, ...owner]

export const byName = new Map()
for (const c of commands) for (const n of [c.name, ...(c.aliases ?? [])]) byName.set(n, c)
