# Dashboard Next.js (standalone) — Coolify builda este Dockerfile (base dir /web).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* são inlinados no build. Schema "public" é onde os dados estão.
# Sobrescreva via build args no Coolify se mudar (ex: evohub após migrar).
ARG NEXT_PUBLIC_SUPABASE_SCHEMA=public
ARG NEXT_PUBLIC_BRIDGE_URL=https://cofre.camposoberano.com.br
ENV NEXT_PUBLIC_SUPABASE_SCHEMA=$NEXT_PUBLIC_SUPABASE_SCHEMA
ENV NEXT_PUBLIC_BRIDGE_URL=$NEXT_PUBLIC_BRIDGE_URL
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
