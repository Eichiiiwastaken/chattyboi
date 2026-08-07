FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache g++ make python3
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec next build
RUN pnpm exec esbuild lib/db/migrate.ts --bundle --platform=node --format=cjs --outfile=dist/migrate.cjs

FROM base AS run
RUN apk add --no-cache curl su-exec \
    && addgroup -S -g 10001 app \
    && adduser -S -D -u 10001 -G app app \
    && mkdir -p /app/uploads \
    && chown app:app /app/uploads
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/dist/migrate.cjs ./dist/migrate.cjs
COPY --from=build /app/lib/db/migrations ./lib/db/migrations
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 3232
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "node dist/migrate.cjs && exec node server.js"]
