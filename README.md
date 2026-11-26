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

## What the bot can do

| Area | Commands |
| --- | --- |
| General | `.menu` (with picture, `.menu group` opens one section) `.ping` `.alive` `.time` `.say` `.flip` `.8ball` `.calc` `.dice` `.id` |
| Group | `.tagall` `.hidetag` `.kick` `.promote` `.demote` `.link` `.mute` `.unmute` |
| Protection | `.antilink off/delete/kick`, `.welcome on/off/set <text>`, `.goodbye on/off/set <text>` (placeholders `{user} {group} {count}`) |
| Status (owner) | `.autoviewstatus on/off`, `.autolikestatus on/off`, `.setstatusemoji`, `.save` (reply to a status), `.statuslist`, `.getstatus` |
| AI and media | `.ai`, `.imagine`, `.sticker` (reply to an image or short video) |
| Download | `.yts`, `.play`, `.tiktok` |
| Owner | `.mode` `.settings` `.restart` `.setprefix` `.setbotname` `.addsudo` `.removesudo` `.listsudo` `.block` `.unblock` `.vv` (reveal view-once) `.antidelete` `.autoread` `.autotyping` `.anticall` |
| Group extras | `.ginfo` `.admins` `.delete` |

The menu picture is `assets/menu.jpg` (replace it with your own, or set `MENU_IMAGE_URL`). The pairing site plays a theme song from `public/song.mp3` (swap the file to change it; visitors are asked before it plays).

Anti-link and the admin commands need the bot to be a group admin. Admins and owners are never punished by anti-link. Statuses only arrive while the bot is connected, so `.statuslist` and `.getstatus` cover what it saw in the last 24 hours.

## Keeping settings and keys after restarts (optional)

Without this, settings live in `data/settings.json` and the login in `auth/`. That is fine on a VPS or any host with a persistent disk, but hosts like Render's free plan wipe the disk on every restart. To survive that, use your own Supabase project:

1. Create a free project at supabase.com and run `supabase/schema.sql` in its SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (the service_role key, kept secret) on the bot.
3. That is all. Settings are saved a few seconds after each change, the login keys about 20 seconds after they change, and both are saved again when the host stops the bot. On the next start the saved copy wins over the pasted `SESSION_ID`.

If you log out from the phone, the saved login is deleted so a dead copy is never restored. Pair again for a new `SESSION_ID`.

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
- `.mode` lasts until restart; set `MODE` in the environment to make it permanent.
- `.play` uses YouTube, which often blocks cloud hosts (Render, Railway); it may work only from a home or VPS IP. `.tiktok` and the AI commands rely on free third-party services that can change or go down.
- Video stickers need `ffmpeg` installed on the host; image stickers do not.
- This starter was syntax-checked and the session encoding was tested, but it has not been run against live WhatsApp from here. Do a test pairing on your own number after deploying.
