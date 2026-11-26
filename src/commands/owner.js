import { state } from '../config.js'

export default [
  {
    name: 'mode', category: 'Owner', desc: 'Set public or private mode (until restart)', owner: true,
    run: ({ args, reply }) => {
      const m = (args[0] || '').toLowerCase()
      if (!['public', 'private'].includes(m)) return reply(`Mode is ${state.mode}. Use .mode public or .mode private`)
      state.mode = m
      reply(`Mode is now ${m}. Set MODE=${m} in your environment to keep it after a restart.`)
    }
  },
  {
    name: 'restart', category: 'Owner', desc: 'Restart the bot (your host starts it again)', owner: true,
    run: async ({ reply }) => { await reply('Restarting...'); setTimeout(() => process.exit(0), 500) }
  }
]
