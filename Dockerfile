FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Standalone output into the default .next — not `npm run build`, which targets
# .next-prod for the native/pm2 path.
RUN NEXT_OUTPUT=standalone npx next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV ZERO_DB_PATH=/app/data/zero.db
# Listen on every interface, or the published port can't reach it.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib/migrations/files ./lib/migrations/files

EXPOSE 3000
CMD ["node", "server.js"]
