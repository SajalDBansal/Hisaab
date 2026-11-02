# Build from the repository root with --platform linux/amd64.
# Official Node/Bun/Nginx image digests reviewed on 2026-10-26.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
COPY --from=oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# Public URLs are compiled into the export; runtime env files cannot change them.
ARG EXPO_PUBLIC_API_URL=https://api.hisaab.sajaldbansal.com
ARG EXPO_PUBLIC_WEB_API_URL=https://api.hisaab.sajaldbansal.com
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_WEB_API_URL=$EXPO_PUBLIC_WEB_API_URL \
    EXPO_PUBLIC_REQUIRE_LOGIN=true \
    EXPO_NO_DOTENV=1 \
    EXPO_NO_TELEMETRY=1
RUN bun run --cwd apps/native export:web --clear

FROM nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951 AS runtime
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/native/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
