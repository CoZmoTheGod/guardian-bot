# ---- Production image for Guardian (standalone Docker / docker-compose) ----
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Build tooling for native modules (sqlite3, @discordjs/opus) + curl for yt-dlp
# + fonts-dejavu-core so the image captcha can render text.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make gcc g++ git curl ca-certificates fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp (no Python needed) — reliable YouTube extraction for music.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp
# We supply yt-dlp above, so skip youtube-dl-exec's bundled binary download.
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true
# Point PyInstaller's temp extraction dir at /tmp (always exec-friendly in proper
# Docker containers). On Pelican nodes with noexec /tmp, override via the panel.
ENV TMPDIR=/tmp

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the source.
COPY . .

# Persistent data directory for the default SQLite database.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Web dashboard port (matches DASHBOARD_PORT default). Publish this in your
# compose file or `docker run -p 3000:3000` to expose the panel.
EXPOSE 3000

CMD ["npm", "start"]
