# Service d'analyse fondamentale crypto — Node pur (ESM, fetch natif), sans build
# ni dépendance native. Mono-stage : on installe les deps puis on copie le code.
FROM node:24.11-alpine3.22

WORKDIR /app

# Outil pour le HEALTHCHECK (wget est déjà dans busybox ; curl optionnel).
# Dépendances d'abord = couche cachée tant que package*.json ne bouge pas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code applicatif (data/, .env, node_modules exclus via .dockerignore).
COPY . .

# Dossier de persistance (monté en volume en prod).
RUN mkdir -p data

ENV NODE_ENV=production \
    API_PORT=3000

EXPOSE 3000

# Le service est sain si l'API répond.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://localhost:${API_PORT}/api/health" >/dev/null 2>&1 || exit 1

# serve.mjs = boucle de collecte horaire + IA (fond + bascule) + webhook + API, en 1 process.
CMD ["node", "serve.mjs"]
