# Builds the web app (Vite → static) and serves it with nginx.
# Build context must be the repo root:
#   docker build -f packages/web/Dockerfile -t p2p-web .
# VITE_* values are inlined at BUILD time — they must be reachable from the
# user's browser (i.e. host-mapped ports), not the docker network.
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile

ARG VITE_API_URL=http://localhost:8081
ARG VITE_SIGNALING_URL=ws://localhost:8080
ARG VITE_TELEGRAM_BOT_USERNAME=
ARG VITE_STUN_URL=stun:stun.l.google.com:19302
ARG VITE_TURN_URL=
ARG VITE_TURN_USERNAME=
ARG VITE_TURN_CREDENTIAL=
RUN VITE_API_URL="$VITE_API_URL" \
    VITE_SIGNALING_URL="$VITE_SIGNALING_URL" \
    VITE_TELEGRAM_BOT_USERNAME="$VITE_TELEGRAM_BOT_USERNAME" \
    VITE_STUN_URL="$VITE_STUN_URL" \
    VITE_TURN_URL="$VITE_TURN_URL" \
    VITE_TURN_USERNAME="$VITE_TURN_USERNAME" \
    VITE_TURN_CREDENTIAL="$VITE_TURN_CREDENTIAL" \
    pnpm --filter @p2p/web build

FROM nginx:alpine AS runner
COPY --from=builder /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
