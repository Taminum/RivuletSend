# Builds the web app (Vite → static) and serves it with nginx.
# Build context must be the repo root:
#   docker build -f packages/web/Dockerfile -t p2p-web .
#
# The prebuilt prod image is domain-agnostic: with NO VITE_* build args the
# bundle derives the API/signaling URLs from the browser's own origin at runtime
# (Caddy proxies /api and /ws same-origin). The dev docker-compose still passes
# VITE_* args (api/signaling on separate host ports) and those are honored.
#
# CRITICAL: do NOT default VITE_API_URL/VITE_SIGNALING_URL to localhost here — a
# default value is inlined into the bundle and defeats the runtime origin
# fallback (`import.meta.env.VITE_API_URL ?? location.origin + "/api"`), which is
# how the app ends up wrongly calling http://localhost:8081 in production.
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /repo
COPY . .
# Only the web package + its deps — keep the React Native app's deps out of this image.
RUN pnpm install --frozen-lockfile --filter "@p2p/web..."

ARG VITE_API_URL=
ARG VITE_SIGNALING_URL=
ARG VITE_STUN_URL=
ARG VITE_TURN_URL=
ARG VITE_TURN_USERNAME=
ARG VITE_TURN_CREDENTIAL=
# Pass each VITE_* into the build ONLY when non-empty (`${x:+...}`), so an unset
# arg stays truly undefined in the bundle instead of an inlined "" that would
# also defeat the ?? fallback.
RUN env \
    ${VITE_API_URL:+VITE_API_URL="$VITE_API_URL"} \
    ${VITE_SIGNALING_URL:+VITE_SIGNALING_URL="$VITE_SIGNALING_URL"} \
    ${VITE_STUN_URL:+VITE_STUN_URL="$VITE_STUN_URL"} \
    ${VITE_TURN_URL:+VITE_TURN_URL="$VITE_TURN_URL"} \
    ${VITE_TURN_USERNAME:+VITE_TURN_USERNAME="$VITE_TURN_USERNAME"} \
    ${VITE_TURN_CREDENTIAL:+VITE_TURN_CREDENTIAL="$VITE_TURN_CREDENTIAL"} \
    pnpm --filter @p2p/web build

FROM nginx:alpine AS runner
COPY --from=builder /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
