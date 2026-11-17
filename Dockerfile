FROM node:24-alpine

LABEL org.opencontainers.image.title="Vehicle Meter · 车记" \
      org.opencontainers.image.description="Self-hosted vehicle expense, energy, maintenance and reporting app" \
      org.opencontainers.image.version="1.0.0"

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai

WORKDIR /app

RUN apk add --no-cache tzdata \
    && mkdir -p /data \
    && chown -R node:node /data

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node mcp ./mcp

USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
