# 🧪 Development & Live Testing Guide

This guide sets you up to actively debug and test Guardian on a **live private
Discord server** while you build — without ever risking your production bot.

## 1. Create a separate development bot

Always use a **different application/token** for development so testing never
touches your live bot.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application** (e.g. "Guardian Dev").
2. Open **Bot** → **Reset Token** → copy the token. This is your dev
   `DISCORD_TOKEN`.
3. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent**.
4. Copy the **Application ID** (General Information) — this is your `CLIENT_ID`.
5. Invite the dev bot to a **private test server** using the OAuth2 URL
   generator with scopes `bot` + `applications.commands` and the permissions
   listed in the README. Grab your test server's **Guild ID** (enable Developer
   Mode → right-click the server → Copy Server ID) — this is your `GUILD_ID`.

## 2. Configure the dev environment file

Development uses a completely separate env file from production, so the two can
never conflict.

```bash
cp .env.example .env.dev
```

Edit `.env.dev`:

```dotenv
NODE_ENV=development
DEBUG=true
DISCORD_TOKEN=<your DEV bot token>
CLIENT_ID=<your DEV application id>
GUILD_ID=<your test server id>
DATABASE_URL=sqlite://./data/guardian-dev.sqlite
# optional music keys...
```

- With `NODE_ENV=development`, the loader reads **`.env.dev`**.
- With `GUILD_ID` set, slash commands register to **that one guild instantly**
  (global registration can take up to an hour).
- `DEBUG=true` prints command execution, DB queries and API call results.
- A separate `guardian-dev.sqlite` keeps dev data isolated from production.

> Production, by contrast, uses `.env.production` with `NODE_ENV=production`,
> its own token, its own database, and registers commands **globally**.

## 3. Run locally with hot reload

```bash
npm install
npm run dev
```

`npm run dev` runs **nodemon** (via `cross-env NODE_ENV=development`) and
watches `./src`, restarting the bot automatically every time you save a file.
Slash commands re-register to your test guild on each restart.

To register commands without starting the bot:

```bash
npm run deploy          # dev guild (instant) when NODE_ENV=development
npm run deploy:global   # force global registration
```

## 4. Run inside the dev Docker container

This mirrors the panel/production container while still giving you live reload —
your local `./src` is bind-mounted and nodemon runs **inside** the container.

```bash
# uses .env.dev and Dockerfile.dev
docker compose -f docker-compose.dev.yml up --build
```

Edit files locally → nodemon inside the container restarts the bot. Dev data is
persisted in the `guardian-dev-data` volume. Stop with `Ctrl+C` (or
`docker compose -f docker-compose.dev.yml down`).

## 5. Verbose debug logging

Set `DEBUG=true` (default in `.env.dev`) to log:

- every slash command execution (`/command by user in guild`),
- SQL queries (`[sql] ...`),
- music resolution, SponsorBlock skips, and API fallbacks,
- verification lifecycle events.

You can also set an explicit `LOG_LEVEL` of `error`, `warn`, `info`, or `debug`.

## 6. Typical workflow

1. `docker compose -f docker-compose.dev.yml up --build` **or** `npm run dev`.
2. Edit code → save → nodemon restarts automatically.
3. Test the changed slash command in your **private test server** (updates are
   instant because commands register to `GUILD_ID`).
4. Watch the console for `[DEBUG]` output to trace behaviour.
5. When happy, commit and deploy to production (separate token/env/database).

## Production vs development at a glance

| | Development | Production |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| Env file | `.env.dev` | `.env.production` |
| Bot token | Dev application | Live application |
| Commands | Registered to `GUILD_ID` (instant) | Global |
| Database | `guardian-dev.sqlite` | Your prod DB (`DATABASE_URL`) |
| Logging | Verbose (`DEBUG=true`) | Info level |
| Runner | `npm run dev` / `docker-compose.dev.yml` | `npm start` / `docker-compose.yml` / egg |

The two configurations never share files or state, so you can develop safely
against a live test server while production keeps running untouched.
