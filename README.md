# Orbit-MD

A WhatsApp bot (Baileys) plus a pairing website. A person opens the site, types their number, enters the pairing code in WhatsApp, and instantly receives a **SESSION_ID** they can paste into Katabump, a Discord-bot host, Render, Railway, a VPS, anywhere.

No database and no Supabase. The session ID *is* the login (compressed `creds.json`), so there is nothing to host or configure besides Node.

## Two ways to run this repo

| Role | Command | Needs |
| --- | --- | --- |
| Pairing website | `npm run pair` | a host with a public URL (Render, Railway, VPS...) |
| The bot | `npm start` | `SESSION_ID` (or a `session.txt` file) |

You can deploy the same repo twice: once as the website, once per bot owner as the bot.

## Pairing website

1. `npm install`
2. `npm run pair` (set `PORT` on your host). Open the URL.
3. The visitor enters their number, gets an 8-character code, enters it under WhatsApp → Linked devices → Link with phone number.
4. The page shows the session ID (also sent to the user's own WhatsApp chat).

Privacy: pairing uses a temp folder that is deleted when it finishes, and finished session IDs are forgotten from memory after 5 minutes. Attempts are rate limited per IP (`MAX_PAIRINGS` caps concurrent attempts). Put the site behind HTTPS (Render and Railway do this for you).

## Deploying the bot

Set these variables (see `.env.example`):

```
SESSION_ID=ORBIT~...
OWNER_NUMBER=254712345678
PREFIX=.
MODE=public
```

Start command: `npm start`, Node 20+. If your panel limits variable length, put the session ID in `session.txt` in the project root instead. If the host has a persistent disk, the `auth/` folder keeps newer keys across restarts and wins over `SESSION_ID`.

## Adding commands

Create or edit a file in `src/commands/`. Each command is an object:

```js
{ name: 'hello', aliases: ['hi'], category: 'Fun', desc: 'Say hello', run: ({ reply }) => reply('Hello!') }
```

Flags: `owner: true`, `group: true`, `admin: true` (group admins only), `botAdmin: true`. Register new files in `src/commands/index.js`. `.menu` builds itself from the list.

## Caveats

- Baileys is unofficial. WhatsApp can restrict numbers that behave like bots; a spare number is safer.
- Run one session in one place only. Two hosts on the same session disconnect each other.
- A session ID gives full access to the account. Revoke it by removing the device in WhatsApp → Linked devices.
- Settings changed with `.mode` last until restart; set `MODE` in the environment to make them permanent.
- This starter was syntax-checked and the session encoding was tested, but it has not been run against live WhatsApp from here. Do a test pairing on your own number after deploying.
