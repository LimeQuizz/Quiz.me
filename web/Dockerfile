# syntax=docker/dockerfile:1.7
# Quiz.me web image: multi-stage build, standalone Next.js output, no dev
# dependencies in the final image, non-root user, read-only root filesystem
# compatible (only /tmp and /app/.next/cache need to be writable tmpfs).
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /src/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Remove the package managers from the runtime image: nothing installs at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn* \
 && addgroup -S -g 10001 quizme && adduser -S -D -H -u 10001 -G quizme quizme
COPY --from=build --chown=root:root /src/.next/standalone ./
COPY --from=build --chown=root:root /src/.next/static ./.next/static
COPY --from=build --chown=root:root /src/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=root:root /src/drizzle ./drizzle
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
