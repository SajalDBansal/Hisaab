# 25. Docker and CI/CD

[Documentation index](README.md) | [Completion plan](24-completion-plan.md) |
[Owner deployment guide](26-ec2-and-expo-deployment.md)

This describes the small deployment configuration and the supplied
[workflow](../.github/workflows/deploy.yml). Source files are not evidence of a
successful container run or cloud deployment. Record actual container and
deployed acceptance results in [Doc27](27-private-readiness-audit.md).

The installation currently has one user, but the application supports multiple
accounts. Preserve normal registration, recovery and firm membership; deployment
approval does not restrict application admission.

## Keep the File Set Small

| File                               | Single responsibility                                                 |
| ---------------------------------- | --------------------------------------------------------------------- |
| `.dockerignore`                    | Keep credentials, host dependencies and generated files out of builds |
| `deployment/Dockerfile.api`        | Build and run the HTTP API; also contain the migration command        |
| `deployment/Dockerfile.worker`     | Build and run background jobs with Linux Chromium                     |
| `deployment/Dockerfile.website`    | Build and run the public Next.js website                              |
| `deployment/Dockerfile.app`        | Export Expo web and serve its static files with Nginx                 |
| `deployment/nginx.conf`            | SPA fallback, static-file handling and cache headers                  |
| `deployment/compose.dev.yml`       | PostgreSQL/Redis only; apps run on the host                           |
| `deployment/compose.local.yml`     | Build and run app containers on localhost                             |
| `deployment/compose.prod.yml`      | Run published apps, Caddy, PostgreSQL and Redis on EC2                |
| `deployment/Caddyfile`             | Route the three HTTPS domains                                         |
| `deployment/chromium-seccomp.json` | Allow sandboxed Chromium under a restricted syscall policy            |
| `.github/workflows/deploy.yml`     | Type-check, build/publish and deploy in separate jobs                 |

Keep the current [EAS profiles](../apps/native/eas.json),
[Expo config](../apps/native/app.config.js) and `web.output: "single"`
in [app.json](../apps/native/app.json). The worker uses the supplied
`chromium-seccomp.json`; copy it alongside Compose and Caddy. The workflow includes
all three configuration files in review, transfer and rollback copies.

The profile comes unchanged from [Playwright v1.64.0](https://github.com/microsoft/playwright/blob/v1.64.0/utils/docker/seccomp_profile.json),
under its [included Apache 2.0 license](../deployment/chromium-seccomp.LICENSE).
SHA-256: `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
It retains a default-deny syscall policy while allowing the namespace operations
needed by Chromium's sandbox. The local default profile blocked PDF rendering;
do not replace this with an unconfined container or disable the browser sandbox.

The [deployment README](../deployment/README.md) gives exact local/dev/prod
commands and env templates. Root `.dockerignore` stays beside the build context;
GitHub's workflow stays under `.github/workflows`. The dev file supplies local
PostgreSQL/Redis; the production file defines separate password-protected
database services and volumes. No root scripts, generated YAML, wrapper CLI or
second application process manager is needed.

## Build Contracts

Use Node 24, Bun 1.4.0 and the committed lockfile. All Docker builds use the
repository root as their context. Build Linux `amd64` images for the
x86_64 EC2 host. Use the same supported Debian base family across Node stages;
pin reviewed versions/digests when implementing and update them deliberately.

Start with straightforward build/runtime stages. Install dependencies in Linux
with `bun install --frozen-lockfile`, including build dependencies. Build only the
application belonging to that Dockerfile. Put `NODE_ENV=production` in the runtime
stage; do not accidentally omit TypeScript/build dependencies during installation.

| Image / Compose service      | Build                                  | Runtime working directory | Runtime command                                                             |
| ---------------------------- | -------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `hisaab-api` / `api`         | `bun run --cwd apps/api build`         | `/app/apps/api`           | `node dist/server.js`                                                       |
| `hisaab-worker` / `worker`   | `bun run --cwd apps/worker build`      | `/app/apps/worker`        | `node dist/worker.js`                                                       |
| `hisaab-website` / `website` | `bun run --cwd apps/web build`         | `/app/apps/web`           | `node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3002` |
| `hisaab-app` / `app`         | `bun run --cwd apps/native export:web` | Nginx document root       | Standard Nginx foreground command                                           |

The API/worker tsup configs bundle local `@repo/*` modules, but third-party
dependencies remain external. Copy the complete `dist` output, including chunks,
and preserve Linux-installed dependencies and workspace symlinks. Copying only
`dist/server.js`, only a root `node_modules`, or Windows dependencies is insufficient.
For the first version, retaining the installed workspace layout is acceptable;
optimize its size later instead of adding a fragile dependency-pruning script.

The API image must also contain `src/db/migrations`, including SQL and metadata.
Its build emits `dist/migrate.js`; that existing program is the one-off migration
entry point. The Debian runtime must also contain GNU `timeout`; CD uses it
inside the migration container to bound execution even after SSH disconnects.
Verify `docker run --rm --entrypoint timeout IMAGE --version` during container
acceptance. Do not create a second migration wrapper or migrate at every API
startup. Use exec-form Docker commands so Node receives shutdown signals.

For Next.js, retain `.next`, `public`, configuration and dependencies and use the
existing normal server. Do not switch to static export: `/downloads` reads the
release manifest at request time. Standalone output is optional later, not a
prerequisite. [Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying)

`.dockerignore` must exclude real `.env*`/`*.env` files, Git metadata, signing
keys, APKs, backups, exports, logs, host `node_modules`, `.next`, `dist` and local
tool caches. Keep source, public assets, lockfile and database migrations. Check
the actual image contents before pushing. Do not pass secrets as build arguments.

The Bun install line uses Docker's built-in cache mount to reuse downloaded
packages; it still installs from the frozen lockfile. Documentation is excluded
from the build context so editing a guide does not reinstall application packages.
The straightforward runtime images retain workspace dependencies for reliable
module resolution. Allow disk space for both the current and previous release.

## Worker Browser

Install Chromium, its runtime libraries and suitable fonts in the worker image.
If using Debian's package, configure `PDF_BROWSER_PATH=/usr/bin/chromium` and
verify that path inside the finished image. Run the worker as a non-root user,
with an init process, writable temporary storage and sufficient shared memory
(start with `shm_size: 256m`). Confirm the installed browser works with the locked
`playwright-core` version by rendering a real A4 and compact invoice.

Keep `chromiumSandbox: true` in the [existing renderer](../apps/worker/src/pdf/renderer.ts).
If host restrictions prevent browser namespaces, review the official Playwright
seccomp profile and the host policy. Keep any required profile with its provenance
and license. Do not solve this with `--no-sandbox`, `privileged`, an unrestricted
seccomp policy or `SYS_ADMIN`. Browser startup is a release gate, not something a
passing worker health route proves. [Playwright container guidance](https://playwright.dev/docs/docker)

## Public Build Settings

Pass these explicit values into the appropriate Docker build. They are public
configuration, not secrets. Do not rely on a developer's ignored `.env.local`.

| Build    | Variable                            | Production value                                                                               |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Website  | `NEXT_PUBLIC_SITE_URL`              | `https://hisaab.sajaldbansal.com`                                                              |
| Website  | `NEXT_PUBLIC_APP_URL`               | `https://app.hisaab.sajaldbansal.com`                                                          |
| Website  | `NEXT_PUBLIC_SUPPORT_EMAIL`         | `sajaldutt.bansal@gmail.com`                                                                   |
| Website  | `NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL` | Blank until publication; then `https://downloads.hisaab.sajaldbansal.com/approved/latest.json` |
| Expo web | `EXPO_PUBLIC_API_URL`               | `https://api.hisaab.sajaldbansal.com`                                                          |
| Expo web | `EXPO_PUBLIC_WEB_API_URL`           | `https://api.hisaab.sajaldbansal.com`                                                          |
| Expo web | `EXPO_PUBLIC_REQUIRE_LOGIN`         | `true`                                                                                         |
| Expo web | `EXPO_NO_DOTENV`                    | `1`                                                                                            |

Browser configuration is compiled into assets. Editing EC2 env files cannot
change those URLs: rebuild the affected image. Expo public variables must never
contain storage keys, passwords or authentication secrets.
[Expo environment documentation](https://docs.expo.dev/guides/environment-variables/)

Expo web is a single-page application, not a running Metro server. Nginx must
serve existing files, fall back to `index.html` for client routes, and return 404
for missing JS/CSS/assets instead of HTML. Keep HTML and `offline-worker.js`
revalidated; use long immutable caching only for content-hashed assets. Preserve
the current retirement worker, not a new offline-shell cache. No API response
should receive static-asset caching rules.
[Expo web hosting documentation](https://docs.expo.dev/guides/publishing-websites/)

## Compose Contract

The following describes `deployment/compose.prod.yml`. Use the fixed project
name `hisaab` and these seven service names: `api`, `worker`,
`website`, `app`, `caddy`, `postgres`, `redis`. Application images use
`${DOCKERHUB_USERNAME}/hisaab-<name>:${IMAGE_TAG}`; the four suffixes are `api`,
`worker`, `website` and `app`. Caddy uses a reviewed official image; databases
use `postgres:17-alpine` and `redis:7.4-alpine`.

- Publish only Caddy ports 80 and 443. API 3000, website 3002, worker 3011,
  PostgreSQL 5432 and Redis 6379 have no host bindings. The worker health listener
  is loopback-only.
- Use `restart: unless-stopped` for all services and bounded container logs, for
  example `max-size: 10m` and `max-file: 3`.
- Use `init: true` for the Node services, non-root application users and a worker
  `stop_grace_period` of at least 75 seconds.
- API reads `./api.env`; worker reads `./worker.env`. Neither frontend gets them.
  Use `env_file` long syntax with `format: raw`, requiring Compose 2.30 or newer.
- `.env` contains image namespace/tag plus `POSTGRES_PASSWORD` and
  `REDIS_PASSWORD`, with no default passwords. Generate different 64-character
  hexadecimal values using `openssl rand -hex 32` twice. Protect all env files
  with mode 600. Compose injects `DATABASE_URL` and `REDIS_URL` into API/worker;
  the production app env templates do not repeat these URLs.
- Keep Caddy certificate/state volumes persistent; mount its configuration
  read-only. PostgreSQL uses `postgres_data` and Redis uses `redis_data`; with
  project `hisaab`, their Docker names are `hisaab_postgres_data` and
  `hisaab_redis_data`. Do not change the project name between releases or make
  customer data depend on container writable layers.
- PostgreSQL user/database are both `hisaab`, with a 1 GiB memory limit,
  `shared_buffers=128MB` and `max_connections=50`. Redis requires authentication,
  uses AOF/`appendfsync everysec`, `maxmemory 192mb`, `noeviction` and a 384 MiB
  container limit. These are starting limits; monitor memory and failed writes.
- Keep PostgreSQL and Redis only on `backend`, an `internal: true` network shared
  with API/worker. API/worker also join the default network for Caddy and outbound
  R2/email access. Website, app and Caddy do not join `backend`.
- Use a default application network with an available subnet, for example
  `172.30.0.0/24`. Its automatic allocation range is `172.30.0.128/25`, keeping
  other containers away from Caddy's fixed `172.30.0.2` address. Trust exactly
  that Caddy address in the API. Check for VPC/VPN/Docker subnet overlap before
  choosing it; if changed, keep the allocation range separate from Caddy.
- Add meaningful health checks for all seven services. API calls its local
  `/ready` with a bounded timeout; worker runs `node dist/healthcheck.js`;
  website/app make local HTTP requests. Give startup enough time to finish.
  Caddy probes a dedicated loopback-only health listener; do not publish it.
  PostgreSQL and Redis must be healthy before API/worker or a migration starts.

Only the application containers are replaced by a normal release. Database
password changes, image upgrades and memory changes need a separate maintenance
window; `--no-recreate` intentionally leaves running database settings unchanged.
Changing `POSTGRES_PASSWORD` in `.env` does not update an existing PostgreSQL
role. Keep an off-server backup and test recovery before changing database
versions. Persistent volumes alone are not backups or high availability.

The chosen Compose options and `env_file` raw behavior are documented in the
[service reference](https://docs.docker.com/reference/compose-file/services/).
A restart policy restarts exited processes; it does **not** automatically repair
a process merely marked unhealthy. Monitor health and investigate failures.
[Docker restart behavior](https://docs.docker.com/engine/containers/start-containers-automatically/)

The Caddy routing is intentionally small:

```caddyfile
hisaab.sajaldbansal.com {
    reverse_proxy website:3002
}

app.hisaab.sajaldbansal.com {
    reverse_proxy app:80
}

api.hisaab.sajaldbansal.com {
    reverse_proxy api:3000
}
```

Add a private health listener if using the Caddy health check above. Preserve API
paths unchanged, including `/api/auth/*`, `/v1/*` and `/ready`. Start with DNS-only
Cloudflare records so Caddy is the direct internet-facing proxy. Caddy can manage
HTTPS certificates when DNS and the challenge ports are reachable.
[Caddy HTTPS setup](https://caddyserver.com/docs/quick-starts/https)

## One GitHub Workflow

[deploy.yml](../.github/workflows/deploy.yml) has three jobs, using inline CLI
commands. Actions are pinned to official release commits; Bun is pinned to 1.4.0
and Node to the 24.22.1 container build version. Update these pins deliberately.
There is no regression pipeline, deployment framework or root scripts folder.

### Check

PRs, pushes to `main` and manual runs install the frozen lockfile, run
`bun run typecheck`, `bun run build` and the Expo web export. This job receives
no production secrets, uses a standard GitHub Ubuntu runner and never contacts a
business database. It also prints the source Compose/Caddy configuration for
review before production approval. Never print resolved runtime configuration.

These are source/build checks. The publish job builds Linux images; neither job
proves database migration, sandboxed PDF rendering or deployed behavior.

### Publish

After checks, only a push to `main` builds and pushes the four Dockerfiles in a
four-item matrix. Every image gets the same full 40-character Git SHA tag.
There is no `latest` tag. An existing SHA tag is reused when publication is
retried; an inconclusive registry lookup fails the job. Publish changes to build
settings, base images or dependencies under a new reviewed commit. Do not
overwrite released SHA tags outside this workflow.

Only this job receives the Docker Hub push token. No SSH, database, Redis,
authentication, email or private storage credentials belong here.
[GitHub's Docker publication guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [Docker's official actions](https://docs.docker.com/build/ci/github-actions/)
describe the actions used.

### Deploy

The job runs only on `main`, after a successful check and either all four images
publish or a manual dispatch reuses existing images. The single repository
switch is `DEPLOY_ENABLED=true`.

Configure the `production` environment to allow only `main` and **require
approval** before enabling that switch. Review the exact commit, source
configuration, image results, backup and maintenance window before approving.
Approval happens before SSH copies anything. Environment protection depends on
the repository plan; creating an environment name alone does not add review.
If required reviewers are unavailable, leave CD disabled and use the manual SSH
procedure in guide 26. [GitHub environment setup](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

The deployment job uses only the fixed `hisaab-deploy` Ubuntu runner label.
Provision its approved SSH access as described below before enabling CD.

Manual dispatch selects the current `main` commit and **reuses** its published
images. Verify all four SHA tags exist; it never publishes. Do not dispatch from
another branch. For an older release use guide 26's manual recovery procedure.

Deployment uses these steps:

1. Use a temporary private-key file and the previously verified known-hosts
   entry. SSH has strict host-key checking, connection timeouts and keepalives.
2. Copy `deployment/compose.prod.yml`, `deployment/Caddyfile` and
   `deployment/chromium-seccomp.json` into the flat host folder
   `/opt/hisaab/.candidate-RUN-ATTEMPT`.
   Never transfer or overwrite `api.env` or `worker.env`.
3. Acquire the host `.deploy.lock`; refuse to continue if an earlier
   `.deploy-in-progress` marker exists. Require `.env`, `api.env` and `worker.env`
   to exist. Copy `.env` into the private candidate directory, replacing only
   `DOCKERHUB_USERNAME`/`IMAGE_TAG` and preserving the database passwords.
   Validate candidate Compose silently, pull images, and validate the candidate
   Caddyfile without replacing live files.
4. Save the previous config and private `.env` in `.previous-RUN-ATTEMPT`.
   Write the incomplete marker and stop API/worker with 90 seconds of shutdown
   grace. Start PostgreSQL/Redis with `up -d --no-recreate --wait
--wait-timeout 120 postgres redis`, bounded by an outer 180-second timeout.
   Existing database containers and their volumes stay in place.
5. Dump PostgreSQL with `pg_dump -U hisaab -d hisaab -Fc` into
   `backups/predeploy-RUN-ATTEMPT.dump.partial`, with a 180-second timeout.
   Require successful `pg_restore --list` within 30 seconds before renaming it
   to `.dump`. A failed backup stops deployment before migration. This private,
   host-local dump is not an independent backup or a completed restore test.
6. Run the new API image's existing `node dist/migrate.js` in a named, one-off
   container. GNU `timeout` inside that container allows 300 seconds plus
   10 seconds to terminate; the remote command is bounded too. `--rm` disables
   the service restart policy for this one-off container.
7. Only after migration succeeds, install the reviewed config and run
   `up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180
api worker website app caddy`. Check worker health and all three public HTTPS
   endpoints with bounded requests. No database container is recreated here.
8. Install the candidate `.env` with mode 600 and clear the incomplete marker.
   Retain previous/candidate configuration for inspection; both contain private
   `.env` copies. Copy verified backups outside EC2 and clean old local dumps and
   config copies deliberately after acceptance.

Every candidate Compose command explicitly selects the new SHA/namespace and
uses `/opt/hisaab` as its project directory, so runtime env files and mounts
continue to resolve there. PostgreSQL, Redis and Caddy volumes are preserved.

Migration failure or timeout fails the job, keeps the marker and keeps API and
worker stopped. Later failures also attempt to stop writers. No automatic schema
rollback or old-API restart is attempted. An abrupt runner/host loss can interrupt
cleanup: inspect the host and the named migration container before any retry.
Do not blindly remove the marker. See guide 26's recovery procedure.

Workflow and production-job concurrency use `cancel-in-progress: false`.
A new run does not cancel a running migration; pending runs may be replaced by
GitHub's default queue behavior. The host lock also guards against a concurrent
operator command that uses the same lock.
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

The bounded migration uses [Compose one-off containers](https://docs.docker.com/reference/cli/docker/compose/run/).
Health waiting and recreation use [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/).
Never run `down -v`, volume pruning or application builds on EC2.

## GitHub Access to EC2

A security group that allows only your laptop will block an ordinary hosted
runner. Standard GitHub-hosted runners do not offer a small fixed address set.
Use an operator-approved Ubuntu runner with fixed outbound addresses: for
example a larger hosted runner with static IPs, or a separate, restricted
deployment runner. Do not install an Actions runner on the application EC2 host.
[GitHub runner IP guidance](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#ip-addresses)

The operator must manually allow TCP 22 from that runner's exact approved
addresses in EC2's security group, retain their own administration rule, and
verify reachability. Give this runner the label `hisaab-deploy` used in the
workflow. It needs current Actions runner support for the pinned actions, Git,
Bash, OpenSSH and GNU `timeout`.
Only the protected deploy job uses it; PR checks/publication use hosted runners.
Keep any self-hosted deployment runner restricted to trusted workflows.

No AWS credentials, OIDC role, dynamic firewall automation or broad SSH rule is
needed. If no approved runner is available, leave CD disabled and deploy
manually. Never open SSH to `0.0.0.0/0` to make a run pass.

Verify the host-key fingerprint through the AWS console or another trusted
channel before storing `EC2_KNOWN_HOSTS`. The stored line must match the exact
`EC2_HOST` DNS name or IPv4 address. Do not disable host-key checking or trust
unverified `ssh-keyscan` output. Use a dedicated deployment key.

## GitHub Configuration Inventory

Create these in **Settings → Secrets and variables → Actions**, except the
explicitly marked `production` values:

| Location              | Name                                | Value/purpose                                                         |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Repository secret     | `DOCKERHUB_TOKEN`                   | Docker Hub token with write access to the four repositories           |
| Repository variable   | `DOCKERHUB_USERNAME`                | Docker Hub username/namespace used for login and image names          |
| Repository variable   | `NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL` | Blank until APK publication; then the approved public manifest URL    |
| Repository variable   | `DEPLOY_ENABLED`                    | `false` until the host, services and release are ready                |
| `production` secret   | `EC2_SSH_PRIVATE_KEY`               | Dedicated deployment key, never the everyday administration key       |
| `production` secret   | `EC2_KNOWN_HOSTS`                   | Independently verified host-key line matching `EC2_HOST`              |
| `production` variable | `EC2_HOST`                          | Stable DNS name or Elastic IPv4 address; SSH port 22                  |
| `production` variable | `EC2_USER`                          | Host user with access to Docker and `/opt/hisaab`, initially `ubuntu` |

The other public frontend values are explicit in the workflow and Dockerfiles.
Review and update them together if domains change. EC2 logs into Docker Hub
separately using a read-only pull token. Application secrets remain exclusively
in EC2 env files; EAS signing credentials remain with Expo/the operator.

Before enabling automatic deployment, demonstrate a failed migration and failed
health check on isolated infrastructure, including the stopped-writer behavior.
Record actual results separately; neither the workflow source nor these
instructions claim those checks have already passed.
