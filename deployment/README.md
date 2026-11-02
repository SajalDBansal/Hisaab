# Deployment

Run the commands below from the repository root. Docker Compose 2.30 or newer
is required. Choose a mode below; each Compose file has one purpose.

| File                | What runs                                            | Database and Redis                                    |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `compose.dev.yml`   | PostgreSQL and Redis only; apps run on your computer | Persistent development containers                     |
| `compose.local.yml` | Locally built API, worker, website and Expo web app  | Existing services, or add the dev file as shown below |
| `compose.prod.yml`  | Published apps, Caddy, PostgreSQL and Redis on EC2   | Private production containers with persistent volumes |

The four Dockerfiles, Nginx, Caddy and Chromium sandbox policy live here. Build
context remains the repository root so shared packages are included. Root
`.dockerignore` excludes credentials and host dependencies. GitHub requires its
workflow in `.github/workflows/deploy.yml`.

Before the first release, complete the additional findings in the
[current audit](../docs/29-system-audit-and-work-plan.md). The
[daily R2 backup and EC2/account migration guide](../docs/30-postgres-r2-backup-and-ec2-migration.md)
is the implementation plan for the requested backup job; the supplied worker
does not run that job yet.

## Development: Apps on Your Computer

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

## Local: Compiled Apps in Containers

Copy `local.api.env.example` to `local.api.env`, and `local.worker.env.example`
to `local.worker.env` inside this folder. Keep an existing configured file.
Generate a local auth secret, for example with `openssl rand -hex 32`, and put
it in `local.api.env`. API and worker must use the same database, Redis and R2
bucket. Values are literal `KEY=value`, without enclosing quotes or substitutions.

The provided examples use the `postgres` and `redis` service names. To use those
development services with the app containers, run both files as one local project:

```sh
docker compose -p hisaab-local -f deployment/compose.local.yml -f deployment/compose.dev.yml up -d --wait postgres redis
docker compose -p hisaab-local -f deployment/compose.local.yml -f deployment/compose.dev.yml build
docker compose -p hisaab-local -f deployment/compose.local.yml -f deployment/compose.dev.yml run --rm --no-deps api node dist/migrate.js
docker compose -p hisaab-local -f deployment/compose.local.yml -f deployment/compose.dev.yml up -d --no-build --wait
```

Stop the host development setup first if it uses the same ports. The explicit
project name keeps this container-preview database separate from `hisaab-dev`.
For this local preview, PostgreSQL/Redis come from the dev file. Production has
its own password-protected services and separate volumes in `compose.prod.yml`.

If using already-running external services, instead replace both URLs in the
two local env files with container-reachable addresses and use only:

```sh
docker compose -f deployment/compose.local.yml build
docker compose -f deployment/compose.local.yml run --rm --no-deps api node dist/migrate.js
docker compose -f deployment/compose.local.yml up -d --no-build --wait
```

Use a sample database for this preview. `localhost` inside a container means that
container, not your computer or another container. Docker Desktop host services
can use `host.docker.internal`; Linux host access requires separate host networking
configuration. Using the combined dev-file commands above avoids that difference.

| Address                       | Application            |
| ----------------------------- | ---------------------- |
| `http://localhost:8081`       | Signed-in Expo web app |
| `http://localhost:3002`       | Product website        |
| `http://localhost:3000/ready` | API readiness          |

These ports bind only to your computer. Local runs use compiled builds without
hot reload. API/worker use development settings to support local HTTP and logged
verification codes; production keeps its HTTPS/email/storage requirements. R2 is
optional for local accounting but required for document uploads and private PDFs.
Set all four R2 values in both local env files to exercise those features. The
worker uses the container's sandboxed Chromium automatically.

Rebuild after code or frontend URL changes. For env changes, recreate the affected
API/worker container. Stop the combined setup using the same two files:

```sh
docker compose -p hisaab-local -f deployment/compose.local.yml -f deployment/compose.dev.yml down
```

For external services, omit the second `-f` and keep using only the local file.

## Production: Published Images on EC2

`compose.prod.yml` runs seven services: API, worker, website, Expo web app, Caddy,
PostgreSQL 17 and Redis 7.4. It has no build instructions. The workflow builds
the four application images from the repository root and publishes them;
PostgreSQL, Redis and Caddy use official images. Example for one manual build:

```sh
docker build --platform linux/amd64 -f deployment/Dockerfile.api -t YOUR_DOCKERHUB_USERNAME/hisaab-api:YOUR_TAG .
```

Use `.env.example`, `api.env.example` and `worker.env.example` as templates for
the private files beside `compose.prod.yml` on EC2. `.env` contains the Docker Hub
namespace, published image tag and two different passwords: `POSTGRES_PASSWORD`
and `REDIS_PASSWORD`. Generate each password with `openssl rand -hex 32`; keep
them stable across releases and protect all three env files with `chmod 600`.
Replace auth, email and R2 placeholders in `api.env`/`worker.env` too.

Compose supplies `DATABASE_URL` and `REDIS_URL` to both API and worker using those
passwords and the service names `postgres`/`redis`. Do not put database URLs in
the production app env files or reuse local development credentials. PostgreSQL
and Redis have no host ports and join only the internal `backend` network, which
API and worker also join. Other services cannot directly access that network.

The `postgres_data` and `redis_data` named volumes survive container replacement.
Keep the project name `hisaab` so future releases use the same volumes. EC2/EBS
failure can still lose data: make verified backups outside EC2 before relying on
this installation. Redis uses AOF with a one-second fsync interval and
`noeviction`; PostgreSQL has a 1 GiB container limit, and Redis has a 384 MiB
container limit with a 192 MiB data limit. Monitor disk and memory as books grow.

Normal releases preserve the database containers, stop API/worker for the backup
and migration, then recreate only the four apps and Caddy. Never run production
`down --volumes`, prune its volumes or rotate database passwords as a release
step. The workflow preserves `.env` secrets when updating the image tag and leaves
`api.env`/`worker.env` in place. Follow guide 26 for the complete deployment order,
database maintenance and off-server backup/restore procedure.

For local configuration validation, after preparing `deployment/.env`, `api.env`
and `worker.env`, run:

```sh
docker compose --env-file deployment/.env -f deployment/compose.prod.yml config --quiet
```

Do not start production on your laptop just to preview the UI: Caddy uses the real
domains and public ports. Follow [guide 26](../docs/26-ec2-and-expo-deployment.md)
for EC2, DNS, secrets, backups, migration and first deployment. See
[guide 25](../docs/25-docker-and-cicd.md) for the workflow and image details.

The location of `.dockerignore` follows Docker's
[build-context rules](https://docs.docker.com/build/concepts/context/#dockerignore-files).
Combining the local and dev files follows Compose's
[merge rules](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/);
all relative paths here share this deployment directory.
