FROM node:24-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM development AS build
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
RUN npm run typecheck && npm test
# Build-time validation only; no production credentials enter an image layer.
RUN mkdir -p public && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build
RUN npm run build:runtime

FROM node:24-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist-runtime ./dist-runtime
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --chown=node:node package.json ./
USER node
CMD ["node", "dist-runtime/src/worker/main.js"]
