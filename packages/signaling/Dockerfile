# Signaling server image.
# The build context MUST be the repo root (it needs the pnpm workspace):
#   docker build -f packages/signaling/Dockerfile -t p2p-signaling .
#   docker run -p 8080:8080 p2p-signaling

# ---- builder: install workspace, bundle server (inlines @p2p/shared) ----
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @p2p/signaling build

# ---- runner: minimal image, only the bundle + `ws` at runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# esbuild kept `ws` external, so install just that. Bundle is ESM, hence type:module.
RUN printf '{"type":"module","dependencies":{"ws":"^8.18.0"}}' > package.json \
  && npm install --omit=dev --no-audit --no-fund
COPY --from=builder /repo/packages/signaling/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
