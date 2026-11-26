import general from './general.js'
import group from './group.js'
import owner from './owner.js'

export const commands = [...general, ...group, ...owner]

export const byName = new Map()
for (const c of commands) for (const n of [c.name, ...(c.aliases ?? [])]) byName.set(n, c)
