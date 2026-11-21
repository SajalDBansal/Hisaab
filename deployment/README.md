# Development containers

`compose.dev.yml` runs PostgreSQL and Redis for development; the apps run on
your computer. Run the commands below from the repository root (Docker Compose
2.30 or newer). The app is not deployed anywhere for now, so this folder holds
no production files.

Start just the dependencies:

```sh
docker compose -f deployment/compose.dev.yml up -d --wait
bun install --frozen-lockfile
```

Create each app's env file from its existing `.env.example` only if it does not
already exist. API and worker use these URLs for the new development database:

```dotenv
DATABASE_URL=postgres://hisaab:hisaab@localhost:55432/hisaab
REDIS_URL=redis://localhost:16379
```

Apply migrations, then start the apps on the host:

```sh
bun run --cwd apps/api db:migrate
bun run dev
```

For individual processes, use the commands in the [root README](../README.md).
Set the worker's `PDF_BROWSER_PATH` to your installed Chromium/Edge executable.
App code changes reload through the usual development tools. For a phone, use
your computer's LAN API address in the Expo configuration.

PostgreSQL binds to `127.0.0.1:55432`; Redis binds to `127.0.0.1:16379`. Their
simple credentials are for local development only. Change `POSTGRES_PORT` or
`REDIS_PORT` in your shell if necessary, and update the app URLs to match.

```sh
docker compose -f deployment/compose.dev.yml down
```

This stops the services while preserving their volumes. Do not add `--volumes`
unless you deliberately want to erase that development database and queue.
These are new, separately named volumes; existing databases are not imported.
