FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./

# Don't download Puppeteer's bundled Chromium: on Alpine (musl libc) that glibc
# build can't run. We install the distro's Chromium in the runner stage instead
# and point Puppeteer at it via PUPPETEER_EXECUTABLE_PATH.
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN npm ci


FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Chromium + the shared libraries and fonts it needs to render the quotation
# PDFs (this is what fixes "libnspr4.so: cannot open shared object file").
# `font-noto` covers Arabic so the RTL quotation text isn't tofu boxes.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["sh", "-c", "npm start -- --hostname 0.0.0.0 --port ${PORT:-8080}"]
