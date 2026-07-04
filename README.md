# 🛡️ Guardian — All-in-One Discord Bot

A production-ready, multi-guild Discord bot built on **discord.js v14**. Every
setting is stored **per-server in a database** and configured entirely through
**slash commands** — no manual JSON editing. Deployable with **Docker** or a
**Pterodactyl / Pelican egg**.

## Features

| Module | What it does |
| --- | --- |
| **Moderation** | Channel `/lock` & `/unlock` — denies `Send Messages` for `@everyone` and **restores the exact previous state** on unlock. |
| **Music** | Play from **YouTube** and **Spotify** (links or search). Spotify resolves via the Spotify Web API, then streams matching audio from YouTube. Full queue: skip, pause, resume, loop, shuffle, volume, now-playing. **SponsorBlock** auto-skips sponsor/intro segments. |
| **Reaction Roles** | Designate a react-role channel, post embeds, map emoji → roles. Multiple panels per server, optional "one role at a time" mode. |
| **Security / Anti-Bot** | Captcha on join (**button**, **text**, or **image**), configurable verification channel or DM delivery, auto **kick/flag** on timeout, plus **raid detection** (mass-join rate limiting). |
| **Backup & Restore** | Snapshot roles (perms/colors/hierarchy), channels (categories, overwrites, topics) and emoji. Store multiple named backups; `list` / `info` / `load` / `delete`. Restricted to the owner or a configurable role. |
| **Join / Leave** | Custom join/leave messages with placeholders, welcome DMs, and ghost-ping detection. |

## Requirements

- **Node.js 20+** (or Docker)
- A Discord application with a **bot token** — enable the **Server Members Intent**
  in the Developer Portal (Bot → Privileged Gateway Intents).
- Optional: YouTube Data API key, Spotify app credentials.
- **yt-dlp** powers music audio extraction (play-dl/ytdl-core are frequently
  broken by YouTube changes). It's handled automatically: bundled via
  `youtube-dl-exec` for local runs, and the Docker image / egg fetch a
  standalone binary that self-updates on start. Override with `YT_DLP_PATH`.

## Quick start (local)

```bash
git clone <your-repo-url> guardian-bot
cd guardian-bot
npm install

# Configure (production)
cp .env.example .env.production
#   edit .env.production and set NODE_ENV=production + DISCORD_TOKEN

npm start
```

For an instant-feedback development setup with a **separate dev token** and
hot reload, see **[DEVELOPMENT.md](DEVELOPMENT.md)**.

## Configuration

The bot loads its environment file based on `NODE_ENV`:

| `NODE_ENV` | File loaded |
| --- | --- |
| `production` | `.env.production` |
| `development` | `.env.dev` |
| _(unset/other)_ | `.env` |

Real environment variables always take precedence, so Docker/panel-injected
values work without any file.

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | Bot token. |
| `CLIENT_ID` | ⚠️ | Application ID. Needed for `npm run deploy`; auto-detected at runtime otherwise. |
| `GUILD_ID` | dev | Test guild for **instant** command registration in development. |
| `DATABASE_URL` | ✅ | `sqlite://./data/guardian.sqlite` (default) or `postgres://user:pass@host:5432/db`. |
| `YOUTUBE_API_KEY` | optional | YouTube Data API v3 key for reliable search. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional | Enables Spotify link/search resolution. |
| `NODE_ENV` | optional | `production` or `development`. |
| `DEBUG` | optional | `true` for verbose command/DB/API logging. |
| `DASHBOARD_ENABLED` | optional | `true` to enable the web dashboard. |
| `DASHBOARD_PORT` | optional | Port the web dashboard listens on (default `3000`). |
| `DASHBOARD_URL` | dashboard | Public URL used to build the OAuth redirect (must match Developer Portal). |
| `DASHBOARD_SESSION_SECRET` | dashboard | Long random string used to sign session cookies. |
| `DISCORD_CLIENT_SECRET` | dashboard | OAuth2 client secret from the Discord Developer Portal. |

## Web dashboard

Guardian ships with an **optional web control panel** so admins can configure
everything without slash commands. Enable it with `DASHBOARD_ENABLED=true` and
open the URL you set in `DASHBOARD_URL`.

**Access model.** Log in with your Discord account (OAuth2, no password
stored). The dashboard automatically shows you **only the servers where the
bot is present AND you have "Manage Server" permission**. So if you share the
URL with a teammate, they log in with their own Discord account and see only
the servers they can already manage — no separate ACL to maintain.

**One-time setup.**
1. In the [Discord Developer Portal](https://discord.com/developers/applications),
   open your bot's application → **OAuth2**.
2. Under **Redirects**, add `<DASHBOARD_URL>/auth/callback` (e.g.
   `http://localhost:3000/auth/callback` for local dev,
   `https://guardian.example.com/auth/callback` in production).
3. Copy the **Client Secret** into `DISCORD_CLIENT_SECRET`.
4. Generate a session secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   → paste into `DASHBOARD_SESSION_SECRET`.
5. Start the bot. It logs the URL on boot:
   `[dashboard] Web panel listening on http://localhost:3000 (port 3000)`.

The dashboard covers every setting the slash commands do: logging, music
defaults, welcome / leave / DM messages, verification & captcha, raid
detection, reaction-role panel management, backups, and locked-channel
listing.

## Command reference

**Moderation**
- `/lock [channel] [reason]` — lock a channel for `@everyone`.
- `/unlock [channel]` — restore the previous permission state.

**Music**
- `/play <query>` · `/skip` · `/pause` · `/resume` · `/stop`
- `/queue` · `/nowplaying` · `/loop <off|track|queue>` · `/shuffle` · `/volume <0-200> [save]`

**Reaction roles** — `/reactionrole`
- `setchannel` · `create` · `add` · `remove` · `delete` · `list`

**Security** — `/security`
- `verification setup|disable|status`
- `raid config|status|reset`

**Backup** — `/backup`
- `create` · `list` · `info` · `load` · `delete`

**Welcome / Leave** — `/welcome`
- `join` · `leave` · `dm` · `toggle` · `test` · `status`

**Settings** — `/settings`
- `view` · `logchannel` · `djrole` · `backuprole` · `sponsorblock` · `reset`

### Message placeholders (welcome/leave)
`{user}` `{user.tag}` `{user.name}` `{user.id}` `{server}` `{memberCount}`

## Recommended bot permissions

Manage Roles, Manage Channels, Kick Members, Manage Messages, Add Reactions,
Read/Send Messages, Embed Links, Attach Files, Connect, Speak, and Manage
Expressions (for restoring emoji). Invite with the `applications.commands` scope.

## Deployment

### Docker (standalone)

```bash
cp .env.example .env.production   # fill it in, NODE_ENV=production
docker compose up -d --build
```

Uses SQLite by default (persisted in the `guardian-data` volume). To use
PostgreSQL, uncomment the `db` service in
[docker-compose.yml](docker-compose.yml) and update `DATABASE_URL`.

### Pterodactyl / Pelican egg

Pelican uses the same egg schema as Pterodactyl, so
[egg-guardian-bot.json](egg-guardian-bot.json) imports into **both**:

1. Admin → **Import Egg** (or Import from URL) and select the JSON.
2. Create a server using the **Node.js 20** (`ghcr.io/parkervcp/yolks:nodejs_20`) image.
3. Set the panel variables: `DISCORD_TOKEN`, `CLIENT_ID`, `YOUTUBE_API_KEY`,
   `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `DATABASE_URL`, and `GIT_REPO`.
4. The install script installs `git`, `make`, `gcc`, `g++`, `python3`, clones
   your repo and runs `npm install`. On boot it optionally `git pull`s, runs
   `npm install && npm start`, and the panel detects the **`Guardian bot is
   online`** log line as the "running" state.

## Database

- **SQLite** (default): zero-config, stored at `./data/guardian.sqlite`.
- **PostgreSQL**: set `DATABASE_URL=postgres://...`. Tables are created
  automatically on first run.

## Project structure

```
src/
  index.js              # entry point
  config.js             # env loading + validation
  logger.js             # console + per-guild log channel
  loaders.js            # command/event auto-loaders
  register.js           # slash command registration
  commands/             # moderation, music, reactionroles, security, backup, welcome, settings
  events/               # ready, interactionCreate, member add/remove, reactions, messageDelete, guild*
  modules/              # music/, security/, backup/  (feature logic)
  database/             # Sequelize instance + models
  utils/                # embeds, permissions, time helpers
```

## License

MIT — see [LICENSE](LICENSE).
