# Service d'analyse fondamentale crypto — Node (ESM, fetch natif). Depuis la V2,
# un pilier SCRAPE par navigateur (Puppeteer) impose Chromium : on l'installe via
# apk (pas le Chromium bundlé de Puppeteer, incompatible musl/Alpine) et on pointe
# Puppeteer dessus. Mono-stage : deps puis code.
FROM node:24.11-alpine3.22

WORKDIR /app

# Chromium système + polices/libs requises par le rendu headless. PUPPETEER_*
# empêche le download du Chromium bundlé (KO sous Alpine) et pointe l'exécutable.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Dépendances d'abord = couche cachée tant que package*.json ne bouge pas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code applicatif (data/, .env, node_modules exclus via .dockerignore).
COPY . .

# Dossier de persistance (monté en volume en prod ; contient aussi data/scrape/).
RUN mkdir -p data

ENV NODE_ENV=production \
    API_PORT=3000

EXPOSE 3000

# Le service est sain si l'API répond.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://localhost:${API_PORT}/api/health" >/dev/null 2>&1 || exit 1

# src/serve.mjs = boucle de collecte horaire + IA (fond + bascule) + job de scrape
# navigateur découplé + webhook + API, en 1 process.
CMD ["node", "src/serve.mjs"]
