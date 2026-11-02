# 26. EC2 and Expo Deployment

[Documentation index](README.md) | [Completion plan](24-completion-plan.md) |
[Docker and CI/CD specification](25-docker-and-cicd.md)

This is the operator's runbook for the supplied small deployment configuration.
**Verify the images against isolated sample data before using business books.**
The local Linux-container and sample-data checks are recorded in
[Doc 27](27-private-readiness-audit.md). AWS, Docker Hub publication, Expo signing
and the intended production services still require your configuration and checks.

There is currently one person using the app; it retains multi-account support,
normal registration/recovery and firm membership. The earlier owner-only
admission recommendation in Doc27 is superseded. Complete the remaining
[readiness gates](27-private-readiness-audit.md) and preserve firm isolation.
Public APK hosting and store publication can wait. This supplied workflow and
Compose file publish/run all four images, including the website.

Commands labelled `bash` run on Ubuntu EC2 unless stated otherwise. Commands
labelled `powershell` run on your Windows computer. Replace all uppercase
placeholders before use. Never paste credentials into chat, commit them or put
them in frontend build variables.

## Phase 3: Prepare Storage and Credentials

### PostgreSQL

Production PostgreSQL runs as `postgres:17-alpine` on the same EC2 instance.
Compose creates database/user `hisaab` and stores its data in the persistent
`hisaab_postgres_data` volume. Port 5432 is not published. Only API, worker and
the two database services join the internal `backend` network.

Generate a distinct `POSTGRES_PASSWORD` with `openssl rand -hex 32` and retain it
in the server's private `.env`. Compose injects the connection URL into both
API and worker; do not create a Neon/RDS account or copy a development URL into
the production app env files. The initial user can run the existing migrations,
including `pg_trgm`. This simple installation uses that same role at runtime;
database access is restricted to trusted server containers and administrators.

The container limit is 1 GiB, with `shared_buffers=128MB` and
`max_connections=50`. Those settings leave room for the initial connection pools,
not an unlimited number of API/worker replicas. Measure memory and disk usage
before increasing concurrency.

The current pools allow up to ten API business connections, four worker business
connections, one additional readiness connection per service and one migration
connection. Leave room for administration and recovery.

Arrange private backups outside EC2 and a restore check before storing real
books. A named volume survives a container replacement, but not every disk or
instance loss. There is no automatic point-in-time recovery in this setup.
The backup procedure is in Phase 8 below.

Do not run `db:seed`, `drizzle-kit push` or a destructive reset on business books.
An existing development database is not automatically an approved production
dataset; review demo accounts, sample firms and retention before moving it.

### Redis

Production Redis runs as `redis:7.4-alpine` on the same EC2 instance, with no
published port and a separate `hisaab_redis_data` volume. Generate another
password with `openssl rand -hex 32` for `REDIS_PASSWORD` in `.env`; Compose
injects its authenticated `redis://` URL into API/worker. Connections remain on
the internal Docker network, not across the public internet.

Redis uses AOF persistence with `appendfsync everysec`, `noeviction`, a 192 MiB
data limit and a 384 MiB container limit. Reaching the data limit rejects writes
instead of discarding queued jobs; monitor failures and memory. Persistence can
still lose roughly the last second of writes after an abrupt failure. It is not
an independent backup. Redis carries queue jobs as well as rate-limit state.
[BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production),
[Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)

Database/Redis images, passwords and settings are maintained separately from
application releases. A regular release starts them if needed without recreating
them; it cannot silently apply a database configuration or password change.

### Private Storage and Email

Follow [storage setup](16-document-storage-setup.md) for the private R2 bucket.
Keep public access disabled. Give API/worker credentials access only to their
required private bucket. The production-origin CORS check passed on 26 October,
as recorded in
[Doc27 G03](27-private-readiness-audit.md#g03--add-the-production-app-origin-to-private-r2-cors).
Retain that policy and still test the deployed app's upload/download flow.
Keep production and local development origins deliberate.

Verify a sending domain in Resend and configure its DNS records. Use a sender
from that domain for `EMAIL_FROM`. The support mailbox
`sajaldutt.bansal@gmail.com` does not by itself verify a Resend sender. Production
needs a real email key; development log output is not an email delivery system.

Record a backup method for originals and thumbnails outside the live document
bucket. R2 durability and an application JSON export are not independent backups.
See [manual recovery](20-manual-recovery.md).

### Docker Hub and GitHub

1. In Docker Hub, create `hisaab-api`, `hisaab-worker`, `hisaab-website` and
   `hisaab-app` under the account used for `DOCKERHUB_USERNAME`. Choose visibility
   deliberately; public images must be free of credentials too.
2. Create a Docker Hub personal access token with read/write permission for
   GitHub, and a separate read-only token for EC2. Scope access to these
   repositories where your account's token controls permit it.
3. In GitHub **Settings → Secrets and variables → Actions**, add repository
   secret `DOCKERHUB_TOKEN` and variable `DOCKERHUB_USERNAME`.
4. Add repository variable `DEPLOY_ENABLED=false`. Leave
   `NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL` blank until a verified APK is published.
5. Protect `main` and require the workflow's `check` job. Review the complete
   release before merging/pushing it. A push to `main` checks then publishes
   all four images. Record the full SHA and verify four matching tags in Docker
   Hub; CD remains disabled.

The full variable/secret inventory is in
[guide 25](25-docker-and-cicd.md#github-configuration-inventory). Do not add
database, Redis, auth, email or R2 credentials to GitHub. Use a new commit for
changed build inputs; do not overwrite a released SHA tag.

## Phase 4: Prove the Images Before Hosting

Use the same images intended for EC2 against disposable sample books. Follow
[phase 4](24-completion-plan.md#phase-4-verify-production-containers-locally),
including a real PDF, an attachment and a migration rerun. Supply staging secrets
through ignored local env files, never Docker build arguments.

For local development, [`deployment/compose.local.yml`](../deployment/compose.local.yml)
builds and runs all four apps on localhost.
[`deployment/compose.dev.yml`](../deployment/compose.dev.yml) runs only PostgreSQL
and Redis for apps running on the host. See
[`deployment/README.md`](../deployment/README.md) for local commands; EC2 uses
the production file and published images described below.

Do not continue merely because `docker build` succeeds. A container can build
while missing a migration file, browser dependency or correct API URL. Record
any platform-specific issue before spending time debugging it on the live host.

## Phase 5: Configure CI/CD

Review the supplied [workflow](../.github/workflows/deploy.yml) and
[its deployment gates](25-docker-and-cicd.md#deploy). Create the `production`
environment in GitHub **Settings → Environments**, restrict deployment branches
to `main`, and require reviewer approval. Verify your plan supports required
reviewers; merely naming an environment is insufficient. If the sole operator
also triggers deployments, keep self-review allowed so they can approve after
reviewing the exact release. Disable administrator bypass if available.

Keep `DEPLOY_ENABLED=false` until SSH secrets, the approved runner network and
EC2 are ready. If reviewers or an approved SSH runner are unavailable, leave CD
disabled and use the manual procedure below.

## Phase 6: First Deployment

### Instance and Network

1. Create an Ubuntu 24.04 LTS x86_64 instance. A starting allocation of two vCPUs,
   4 GiB RAM and 50 GiB encrypted gp3 storage is a sizing estimate for light use
   with both databases on the host, not a capacity guarantee. Measure PDF memory,
   database growth and retained image/backup size; increase capacity if needed.
   Set a budget alert and enable IMDSv2-only metadata access. Verify where Docker
   stores its volumes and keep that EBS volume encrypted. Disable delete-on-
   termination for the volume holding business data; retain off-server backups
   regardless of that setting.
2. Associate an Elastic IP so the DNS and SSH target remain stable. Review AWS
   charges in your account rather than assuming the address/instance is free.
3. Allow inbound TCP 80/443 for public web traffic. Allow TCP 22 only from your
   own current public IPv4 `/32` and, for CD, the fixed addresses of the approved
   deployment runner. Add these rules manually after verifying the addresses.
   Never open SSH to `0.0.0.0/0`. Do not expose 3000, 3002, 3011, 8081, 5432 or 6379. UDP 443 is optional for Caddy HTTP/3.
4. Ensure outbound access supports DNS, HTTPS, Docker Hub, R2, email and backup
   storage. PostgreSQL and Redis need no public security-group rules or external
   endpoints. Never publish their ports as a connection troubleshooting step.

AWS documents [security-group rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html),
[Elastic IP behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)
and [metadata security options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html).

### DNS and HTTPS

Create DNS-only A records pointing to the Elastic IP:

| Name                          | Target         |
| ----------------------------- | -------------- |
| `hisaab.sajaldbansal.com`     | EC2 Elastic IP |
| `app.hisaab.sajaldbansal.com` | EC2 Elastic IP |
| `api.hisaab.sajaldbansal.com` | EC2 Elastic IP |

Do not point `downloads.hisaab.sajaldbansal.com` at EC2; attach it to the public
release bucket later. Do not add an AAAA record without working IPv6 routing.
Start without Cloudflare's HTTP proxy to keep client IPs and Caddy certificate
setup straightforward. Enabling a CDN/proxy later requires a deliberate trusted
proxy review; never use Flexible TLS or cache authenticated API responses.

### Install Docker

Connect using your EC2 key. Verify the SSH host-key fingerprint through a trusted
AWS channel before accepting it.

```powershell
ssh -i "C:\path\to\ec2-key.pem" ubuntu@EC2_ELASTIC_IP
```

Install Docker Engine and the Compose plugin from
[Docker's Ubuntu apt-repository instructions](https://docs.docker.com/engine/install/ubuntu/).
Use that maintained package procedure, not a repository-owned installation script.
Then run on EC2:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
```

Disconnect and reconnect so group membership takes effect. Docker group access
is effectively host-administrator access; keep the SSH key private.

```bash
docker version
docker compose version
sudo install -d -m 750 -o ubuntu -g ubuntu /opt/hisaab
```

Use Compose 2.30 or newer for the raw env-file format. EC2 does not need
Node, Bun, a source checkout, Expo CLI or PM2: the images contain the application
runtime. Docker's boot service and container restart policies provide supervision.

### Host Files

For workflow deployment, create only the runtime env files now; the approved
workflow stages the reviewed configuration from its exact commit. For a manual
deployment, review [`deployment/compose.prod.yml`](../deployment/compose.prod.yml),
[`deployment/Caddyfile`](../deployment/Caddyfile) and the seccomp policy from the
exact published SHA before copying. Use a clean checkout of that commit, not
local uncommitted files. Create a staging directory on EC2:

```bash
install -d -m 700 /opt/hisaab/.candidate-manual
```

From the root of that clean checkout on Windows, verify the SHA and unchanged
config, then copy to staging. The host key must already be verified in your
known-hosts file:

```powershell
git rev-parse HEAD
git diff --exit-code -- deployment/compose.prod.yml deployment/Caddyfile deployment/chromium-seccomp.json
scp -o StrictHostKeyChecking=yes -i "C:\path\to\ec2-key.pem" deployment/compose.prod.yml deployment/Caddyfile deployment/chromium-seccomp.json ubuntu@EC2_ELASTIC_IP:/opt/hisaab/.candidate-manual/
```

The worker needs the supplied
[`deployment/chromium-seccomp.json`](../deployment/chromium-seccomp.json) copied
beside `compose.prod.yml` as `chromium-seccomp.json`. Its source and fingerprint
are recorded in [guide 25](25-docker-and-cicd.md). Review its rules and host support
before deploying.

`deployment/` is the repository's configuration folder. After installation, the
configuration and runtime env files sit directly in the EC2 directory `/opt/hisaab`.
Compose's relative paths resolve there, beside `.env`, `api.env` and `worker.env`.
Staged rollouts retain `--project-directory /opt/hisaab` so they use the same host
env files and mounts.

After a successful deployment, the small host directory contains:

```text
/opt/hisaab/
  compose.prod.yml
  Caddyfile
  chromium-seccomp.json   # sandbox policy used only by the worker
  .env                   # image namespace/tag AND private database passwords
  api.env                # private server settings
  worker.env             # private worker settings
  .deploy.lock
  .candidate-RUN-ATTEMPT/ # staged config and a protected copy of .env
  .previous-RUN-ATTEMPT/  # prior config and protected .env
  backups/               # private local dumps; also copy outside this EC2
```

An incomplete rollout also leaves `.deploy-in-progress`. See recovery below
before removing it or restarting writers. Keep the latest previous config;
remove older candidate/previous copies deliberately after acceptance.

Use [`deployment/api.env.example`](../deployment/api.env.example) and
[`deployment/worker.env.example`](../deployment/worker.env.example) as the
production templates for `api.env` and `worker.env` in `/opt/hisaab`. Replace every
placeholder with the approved settings below. Also use
[`deployment/.env.example`](../deployment/.env.example) for the image tag and
database passwords. Keep candidate/previous directories private because their
copies of `.env` now contain secrets.

Create the env files directly on EC2 with `umask 077` and your editor. Never
source them as shell code. The `format: raw` setting means literal `KEY=value`:
do not add enclosing quotes, shell expressions or inline comments to values.

```bash
cd /opt/hisaab
umask 077
nano .env
nano api.env
nano worker.env
chmod 600 .env api.env worker.env
```

Create `.env` before the first workflow or manual deployment. It contains the
Docker Hub namespace, already published commit and the two generated passwords:

```dotenv
DOCKERHUB_USERNAME=YOUR_DOCKERHUB_USERNAME
IMAGE_TAG=FULL_PUBLISHED_GIT_COMMIT_SHA
POSTGRES_PASSWORD=
REDIS_PASSWORD=
```

Run `openssl rand -hex 32` separately for each password and paste only the
generated hex values. Hex avoids URL escaping and Compose interpolation issues.
The workflow updates only `DOCKERHUB_USERNAME`/`IMAGE_TAG` and retains the other
lines. Do not regenerate passwords on a release or overwrite this file with only
image settings. Changing `.env` alone does not rotate an initialized PostgreSQL
role's password; coordinate rotation with the database and both app services
during planned maintenance.

`api.env` minimum configuration follows. Every `REPLACE_` value must be replaced;
these are not working credentials. Generate a stable random auth secret once,
for example with `openssl rand -hex 32`, and store it securely. Do not regenerate
it on each deployment.

```dotenv
NODE_ENV=production
APP_MODE=normal
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
TRUSTED_PROXY_CIDRS=172.30.0.2/32
BETTER_AUTH_SECRET=REPLACE_WITH_STABLE_RANDOM_SECRET
RECOVERY_EPOCH=REPLACE_WITH_NEW_UUID
BETTER_AUTH_URL=https://api.hisaab.sajaldbansal.com
TRUSTED_ORIGINS=https://app.hisaab.sajaldbansal.com,https://hisaab.sajaldbansal.com,hisaab://
RESEND_API_KEY=REPLACE_WITH_RESEND_KEY
EMAIL_FROM=Hisaab <REPLACE_WITH_VERIFIED_SENDER>
R2_ACCOUNT_ID=REPLACE_WITH_R2_ACCOUNT_ID
R2_BUCKET=REPLACE_WITH_PRIVATE_DOCUMENT_BUCKET
R2_ACCESS_KEY_ID=REPLACE_WITH_PRIVATE_BUCKET_KEY_ID
R2_SECRET_ACCESS_KEY=REPLACE_WITH_PRIVATE_BUCKET_SECRET
DOCUMENT_STORAGE_MAX_BYTES=1073741824
DOCUMENT_STORAGE_MAX_FILES=10000
```

Use Caddy's actual fixed container address if a different subnet was selected.
Never set proxy trust to `*` or the whole internet. Keep API access through Caddy.
The default subnet is `172.30.0.0/24`, with automatic allocations restricted to
`172.30.0.128/25` so another service cannot claim Caddy's `172.30.0.2` address.
Preserve that separation if your host needs a different non-overlapping subnet.

Caddy returns 404 for public `/metrics` requests. Operators can inspect metrics
inside the API container or scrape `http://api:3000/metrics` from a trusted
container on the same network. Keep API port 3000 unpublished; aggregate request
counts and timings should not be exposed on the public domain.

`RECOVERY_EPOCH` is mandatory in production. Generate a unique UUID once for this
installation, for example with `cat /proc/sys/kernel/random/uuid` on Ubuntu, and
save it in `api.env`. Keep it unchanged across ordinary restarts and application
updates. Generate a new UUID only when restoring/rolling back the database,
including a restore onto another EC2 instance. This lets clients detect the
changed recovery point and quarantine uncertain saves. Changing it does not
itself restore data or authorize replay; follow the client reconciliation and
restored-session reset instructions in [Doc 30](30-postgres-r2-backup-and-ec2-migration.md).

Compose injects these URLs into both services, using `.env` passwords. They are
shown for understanding only; do not duplicate them in `api.env`/`worker.env`:

```text
DATABASE_URL=postgres://hisaab:<POSTGRES_PASSWORD>@postgres:5432/hisaab
REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379/0
```

`worker.env` shares the private bucket but has no authentication or email secrets:

```dotenv
NODE_ENV=production
APP_MODE=normal
LOG_LEVEL=info
WORKER_HEALTH_PORT=3011
PDF_BROWSER_PATH=/usr/bin/chromium
BACKUP_ENABLED=false
R2_ACCOUNT_ID=REPLACE_WITH_R2_ACCOUNT_ID
R2_BUCKET=REPLACE_WITH_PRIVATE_DOCUMENT_BUCKET
R2_ACCESS_KEY_ID=REPLACE_WITH_PRIVATE_BUCKET_KEY_ID
R2_SECRET_ACCESS_KEY=REPLACE_WITH_PRIVATE_BUCKET_SECRET
```

If the bucket requires a jurisdiction-specific endpoint, set the same
`R2_ENDPOINT` HTTPS S3 origin in both files, not the public downloads domain.
Optional Sentry settings can be added using the app env examples. Never log the
resolved Compose configuration or attach it to an issue; it contains env values.

### Start Services

First verify a usable database backup/snapshot if it contains data. Confirm the
four images, configuration and approved commit match. Log into Docker Hub on EC2:

```bash
docker login --username YOUR_DOCKERHUB_USERNAME
```

Enter the **read-only** token at the password prompt, not in the command. Keep
Docker's credential file private.

For the first workflow deployment, finish **Enable CD** below, then manually
dispatch the approved `main` commit. Review the config/backup before approving
the production environment job. Manual dispatch does not build or publish images.

If using manual SSH deployment, run **Manual Update or Recovery from Failed CD**
below; the same stopped-writer sequence works for an empty first deployment.
Do not seed/reset business data. Only isolated targets may be used for fault
and migration-failure checks.

### Required Acceptance Checks

| Check             | Pass condition                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS/routing     | All three domains have valid certificates; a deep app URL survives refresh; missing JS returns 404, not the SPA HTML                                                |
| Authentication    | Signup/recovery work; login persists after refresh; confirmed same-type transfer replaces the old session once; phone/browser slots coexist                         |
| Rate limits/proxy | Two independent clients retain distinct IP identities; forged forwarding headers do not bypass limits; documented 10/minute login behavior is preserved             |
| Storage/PDF       | Several images compress and get thumbnails; private downloads work; queued A4/compact PDF completes with sandbox enabled                                            |
| Books             | Create firm -> customer/item -> purchase -> sale -> allocated receipt -> reports; restart services and compare saved values                                         |
| Book categories   | GST/non-GST lots and split bills have correct stock, separate numbering and category/mixed totals                                                                   |
| Access            | Another firm/member cannot read or mutate unauthorized data; period locks still apply                                                                               |
| Offline           | Loaded browser and native app queue supported work; reconnect syncs once; pending changes survive supported restarts; cold browser reload is explicitly not offline |
| Dependencies      | Staging dependency outages produce bounded failures, useful logs and recovery, not hangs or silently lost writes                                                    |
| Backups           | Restore database plus private files into an isolated environment; verify balances and attachment binaries without touching live books                               |

Also complete [release checks](23-release-checklist.md), including loans,
commissions, imports, returns, accounting reports and privacy/support content.
`/ready` proves only its configured dependency checks, not all business features.
Run browser checks against this deployed version and native checks on a real
phone; a desktop browser cannot prove Android camera or encryption compatibility.

Finally schedule a short maintenance window, reboot EC2, reconnect and repeat
`docker compose -f compose.prod.yml ps`, worker health and external readiness. The application should
not depend on your terminal remaining open. Record the results before using real
books or enabling automatic deployment.

### Enable CD

1. Select an approved Ubuntu deployment runner with fixed egress addresses,
   following [guide 25](25-docker-and-cicd.md#github-access-to-ec2). Manually
   allow only those addresses to EC2 TCP 22 and verify access. Assign the runner
   the fixed label `hisaab-deploy`. Do not run PR code on it.
2. Create a dedicated SSH key locally, for example
   `ssh-keygen -t ed25519 -f hisaab-deploy`. For this unattended workflow use
   a dedicated unencrypted private key, protect the file and rotate it if exposed.
   Install only its public key in the EC2 user's `~/.ssh/authorized_keys`.
   Keep directory/file permissions at 700/600. Docker membership grants powerful
   host access.
3. Through a trusted AWS console/administration connection, obtain the host key
   fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.
   Compare it to your known-hosts entry. The GitHub secret must contain a verified
   line in the form `EC2_HOST ssh-ed25519 PUBLIC_HOST_KEY`, not just a fingerprint.
4. In GitHub's `production` environment, add secrets `EC2_SSH_PRIVATE_KEY`
   and `EC2_KNOWN_HOSTS`, plus variables `EC2_HOST` and `EC2_USER=ubuntu`.
   The host value must match the known-hosts line exactly.
5. Verify the environment's required reviewer rule and main-only branch policy.
   After host storage, env files, backups and four images are ready, set
   the single repository switch `DEPLOY_ENABLED=true`.
6. Under **Actions → Check, publish and deploy → Run workflow**, select
   `main`. Confirm that run's SHA already has four published images.
   Review the exact config and backup before approving `production`.
7. Complete acceptance and the isolated failure/restore drill. Subsequent
   successful main publications will also wait for production approval. Set
   `DEPLOY_ENABLED=false` whenever you want publication without deployment.

No AWS/OIDC credentials or firewall-changing permissions are needed. The workflow
does not hold application secrets. If required reviewer protection or an approved
SSH runner is unavailable, leave the switch off and use manual SSH deployment.
Host-key checks stay on.

## Phase 7: Android Release

### Link Expo and Build

Create or select your Expo project. Run EAS from `apps/native`, not the repository
root. The local config reads `EXPO_OWNER` and `EXPO_PROJECT_ID`; set both locally
and in the project's EAS `production` environment with plain-text visibility
(these identifiers are not secrets). Alternatively commit the approved owner and
project ID in Expo configuration; they must resolve locally and on EAS workers.
The current app slug is `native`. If the selected Expo project uses another
slug, set `EXPO_SLUG` to that exact value locally and in the EAS production
environment, or update the approved app configuration. An owner/project ID alone
does not change the slug.
[Expo monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/)

Install the standard EAS CLI with `npm install --global eas-cli`. Create/link the
project with `eas init` if needed, and review any config edits it makes. In the
EAS dashboard, set the same owner/project/slug values in the production
environment before building. Then from `apps/native`:

```powershell
eas login
$env:EXPO_OWNER="YOUR_EXPO_ACCOUNT_OR_ORGANIZATION"
$env:EXPO_PROJECT_ID="YOUR_EXPO_PROJECT_UUID"
$env:EXPO_SLUG="YOUR_MATCHING_EXPO_PROJECT_SLUG"
eas project:info
eas build --platform android --profile direct
```

The existing profile already requires the production API URL and login enabled;
preserve those settings.
[EAS environment setup](https://docs.expo.dev/eas/environment-variables/manage/)

Keep `com.sajaldbansal.hisaab` as the Android package. Securely retain access to
the signing credentials and backups; changing the signing identity can prevent
updates to installed APKs. `direct` creates an installable APK; `production`
creates an AAB for Play Store submission, not a direct website download.
[Expo APK builds](https://docs.expo.dev/build-reference/apk/)

Download the completed APK to your computer. Stop Metro and test installation,
login/device transfer, camera/gallery, reports, sharing, offline/reconnect and an
upgrade over the preceding signed APK. Preserve existing device books during
upgrade. Do not publish just because EAS reported a successful compile.

### Publish to R2

1. Create a **separate** release bucket, attach
   `downloads.hisaab.sajaldbansal.com` as its public custom domain and wait for
   HTTPS activation. Never enable public access on the document bucket.
2. Check the APK version, Android version code and signing certificate from the
   actual build. Use Android SDK `apksigner verify --print-certs` and compare
   the expected signing identity. Record SHA-256 and byte length locally:

```powershell
Get-FileHash .\hisaab.apk -Algorithm SHA256
(Get-Item .\hisaab.apk).Length
```

3. Upload using the R2 dashboard, with an immutable key such as
   `android/1.0.0/1/hisaab.apk`, substituting the real version/build number. Use
   `application/vnd.android.package-archive` as its content type. Never replace
   the bytes of an already published version.
4. Download that public URL, verify its hash/size and install the result. Only
   then upload `approved/latest.json`, following the exact
   [website manifest contract](../apps/web/README.md#android-downloads).
   Use the real timestamp/hash/size/package values, not the illustrative example.
5. Serve the manifest as `application/json` and with revalidation/no long-lived
   CDN cache. Set the website build variable
   `NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL` to its approved URL and rebuild/deploy the
   website if the variable was previously blank.
6. Open `/downloads` and confirm the version, checksum and actual APK destination.
   Future updates to the same manifest URL do not require rebuilding the site;
   the server's successful manifest cache lasts up to 60 seconds.

Cloudflare documents [public bucket custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/).
Use the custom domain for distribution, not the development `r2.dev` endpoint.
Publishing is manual and needs no custom upload script or GitHub release job.
R2 hosts the installable Android file; it does not run the app or replace the API.

For iOS, use the browser app initially. An iOS store release additionally needs
an approved bundle identifier, Apple account, signing and App Store review; the
current config has not completed that setup. An IPA is not an Android-style
public installation link.

## Phase 8: Updates and Operations

### Manual Update or Recovery from Failed CD

Both deployment paths check storage before pulling images, after the pull before
stopping writers, and immediately before the database dump. They require five
GiB of free operating space plus twice the current PostgreSQL volume size; the
first check additionally reserves twelve GiB for candidate image layers. Every
Docker/data/backup filesystem must pass. These conservative budgets match the
current images, not an unlimited database or future larger image. Re-measure
after image growth, keep host disk alerts enabled, and increase the EBS volume
before a threshold fails. The checks use passwordless `sudo -n` for read-only
`df`/`du` on Docker's protected directories; the intended Ubuntu EC2 account must
have that access. No application/database credentials are printed.

Retain at most the current release, one accepted rollback release, and the
candidate image release. Keep at most three completed local pre-deployment
dumps; before the next deployment, reduce them to two. A partial dump requires
inspection, never automatic promotion or deletion. If these bounds are reached,
deployment stops before pulling or pausing writers. Independently verify the
off-server recovery copy and accepted release before manually removing specific
obsolete dump files and image tags. Use `docker image ls`, `docker ps -a`, the
saved `.previous-*` configuration and the release record to identify them;
`docker image rm EXACT_REPOSITORY:EXACT_OLD_SHA` removes only a deliberately
selected old image tag. Never remove the running or accepted rollback image,
use wildcard cleanup, `docker system prune`, `docker volume prune`, or
`down --volumes`. Old `.candidate-*`/`.previous-*` configuration directories also
contain credentials: keep current and rollback configurations private and remove
only individually reviewed obsolete directories. No background cleanup is added.

Application PostgreSQL statements have a 30-second server deadline, a
35-second client read deadline, five-second pool acquisition/lock deadlines,
and a 30-second idle-transaction limit. A stalled read destroys its socket.
Paginated imports and exports may use multiple short statements in a transaction
lasting up to five minutes; they are not restricted to 30 seconds total.
Migration statements instead allow two minutes, with a 125-second client read
deadline and ten-second lock wait, inside the existing five-minute command bound.
PostgreSQL 17 supplies the transaction deadline. Do not disable these limits to
hide slow queries. A timeout during commit can leave an uncertain outcome: keep
the original operation identity and use durable recovery instead of reposting.
Normal Redis commands/socket reads allow two seconds; authentication limits
still fail closed. BullMQ's blocking worker connection keeps separate settings.

Use a verified off-server backup and the four published images for the chosen
commit. Review its configuration before staging it as described under **Host
Files**. Keep `.env`, `api.env` and `worker.env` in place. The sequence below also
takes a fresh local dump after stopping writers. Disable automatic CD while
doing manual maintenance. A short outage is expected.

If `.deploy-in-progress` exists, stop here first. Read its non-secret SHA/config
paths, inspect the workflow error, check `docker ps -a` for
`hisaab-migrate-*`, and confirm no migration is still running. Keep API/worker
stopped. Inspect migration/database state and decide whether a forward repair or
a compatible application restart is appropriate. Remove the marker only after
that decision. Never clear it simply to make a retry pass.

For a reviewed first deployment or update, run this Bash block after replacing
the two placeholders. It uses only staged config and bounds migration inside
the API container; its error trap leaves writers stopped and the marker intact.

```bash
(
set -euo pipefail
umask 077
cd /opt/hisaab
exec 9>.deploy.lock
flock -n 9
test ! -e .deploy-in-progress
test -s .env
test -s api.env
test -s worker.env
export DOCKERHUB_USERNAME=YOUR_DOCKERHUB_USERNAME
export IMAGE_TAG=FULL_NEW_PUBLISHED_COMMIT_SHA
stage=/opt/hisaab/.candidate-manual
sed '/^DOCKERHUB_USERNAME=/d; /^IMAGE_TAG=/d' .env > "$stage/.env"
printf '\nDOCKERHUB_USERNAME=%s\nIMAGE_TAG=%s\n' "$DOCKERHUB_USERNAME" "$IMAGE_TAG" >> "$stage/.env"
chmod 600 "$stage/.env"
compose=(docker compose --project-name hisaab --project-directory /opt/hisaab --env-file "$stage/.env" -f "$stage/compose.prod.yml")
timeout 30s "${compose[@]}" config --quiet
mkdir -p -m 700 backups
docker_root=$(timeout 15s docker info --format '{{.DockerRootDir}}')
[[ "$docker_root" == /* ]]
postgres_path=$(timeout 15s docker volume inspect hisaab_postgres_data --format '{{.Mountpoint}}' 2>/dev/null || true)
redis_path=$(timeout 15s docker volume inspect hisaab_redis_data --format '{{.Mountpoint}}' 2>/dev/null || true)
# No automatic pruning: keep the running and accepted rollback releases.
check_retention() {
  local dumps releases
  dumps=$(find backups -maxdepth 1 -type f -name 'predeploy-*.dump' | wc -l)
  if (( dumps >= 3 )) || find backups -maxdepth 1 -type f -name 'predeploy-*.partial' | grep -q .; then
    echo "Review local backup retention in guide 26 before deploying (at most two previous dumps; no unreviewed partials)." >&2
    return 1
  fi
  releases=$({
    printf '%s\n' "$IMAGE_TAG"
    for service in api worker website app; do
      timeout 15s docker image ls --format '{{.Tag}}' "$DOCKERHUB_USERNAME/hisaab-$service" || return 1
    done
  } | awk '/^[0-9a-f]{40}$/' | sort -u | wc -l)
  if (( releases > 3 )); then
    echo "Review image retention in guide 26: keep current, accepted rollback and candidate releases only." >&2
    return 1
  fi
}
check_space() {
  local phase="$1" image_kib="$2" data_kib=0 needed available path
  if [[ -n "$postgres_path" ]]; then
    data_kib=$(timeout 30s sudo -n du -sk -- "$postgres_path" | awk '{print $1}')
    [[ "$data_kib" =~ ^[0-9]+$ ]]
  fi
  # Five GiB stays free; reserve twice the database size for a dump.
  needed=$((5 * 1024 * 1024 + image_kib + 2 * data_kib))
  for path in "$docker_root" "${postgres_path:-$docker_root}" "${redis_path:-$docker_root}" /opt/hisaab/backups; do
    available=$(timeout 15s sudo -n df -Pk -- "$path" | awk 'NR == 2 {print $4}')
    [[ "$available" =~ ^[0-9]+$ ]]
    if (( available < needed )); then
      printf 'Insufficient disk space %s: need %s KiB free, found %s. Follow guide 26; never prune volumes.\n' "$phase" "$needed" "$available" >&2
      return 1
    fi
  done
}
check_retention
check_space before-pull $((12 * 1024 * 1024))
timeout --kill-after=15s 600s "${compose[@]}" pull
check_space after-pull 0
caddy_image=$(timeout 30s "${compose[@]}" config --images caddy)
timeout 60s docker run --rm --network none -v "$stage/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy_image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
run_id="manual-$(date -u +%Y%m%dT%H%M%SZ)"
previous=".previous-$run_id"
mkdir -m 700 "$previous"
for file in .env compose.prod.yml Caddyfile chromium-seccomp.json; do
  if [[ -f "$file" ]]; then cp -p "$file" "$previous/"; fi
done
printf '%s\n' "$IMAGE_TAG" "$stage" "$previous" > .deploy-in-progress
migration=hisaab-migrate-manual
trap '
  status=$?
  timeout 30s docker rm -f "$migration" > /dev/null 2>&1 || true
  timeout --kill-after=10s 120s "${compose[@]}" stop -t 90 api worker || true
  echo "Deployment incomplete; inspect before restarting writers." >&2
  exit "$status"
' EXIT
timeout --kill-after=10s 120s "${compose[@]}" stop -t 90 api worker
timeout --kill-after=10s 180s "${compose[@]}" up -d --no-recreate --wait --wait-timeout 120 postgres redis
postgres_path=$(timeout 15s docker volume inspect hisaab_postgres_data --format '{{.Mountpoint}}')
redis_path=$(timeout 15s docker volume inspect hisaab_redis_data --format '{{.Mountpoint}}')
check_space before-dump 0
backup="backups/predeploy-$run_id.dump"
timeout --kill-after=10s 180s "${compose[@]}" exec -T postgres pg_dump -U hisaab -d hisaab -Fc > "$backup.partial"
timeout 30s "${compose[@]}" exec -T postgres pg_restore --list < "$backup.partial" > /dev/null
mv "$backup.partial" "$backup"
timeout --kill-after=10s 330s "${compose[@]}" run --rm --no-deps --name "$migration" --entrypoint timeout api --signal=TERM --kill-after=10s 300s node dist/migrate.js
install -m 644 "$stage/compose.prod.yml" compose.prod.yml
install -m 644 "$stage/Caddyfile" Caddyfile
install -m 644 "$stage/chromium-seccomp.json" chromium-seccomp.json
timeout --kill-after=15s 240s "${compose[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 api worker website app caddy
timeout 30s "${compose[@]}" exec -T worker node dist/healthcheck.js
for url in https://api.hisaab.sajaldbansal.com/ready https://hisaab.sajaldbansal.com https://app.hisaab.sajaldbansal.com; do
  timeout 60s curl --fail --silent --show-error --output /dev/null --connect-timeout 5 --max-time 10 --retry 5 --retry-all-errors --retry-max-time 45 "$url"
done
install -m 600 "$stage/.env" .env
rm .deploy-in-progress
trap - EXIT
)
```

Check a business workflow after the health checks, and record the result. The
subshell keeps temporary variables/locks out of later interactive commands.
A failed migration does not imply no SQL ran; inspect before retrying.
The local dump is deliberately created before migration, including on an empty
first deployment. A partial dump or successful archive listing alone is not a
tested recovery copy. Copy the completed dump outside EC2 and retain it until
the new release and its recovery point are accepted.

Always keep project name `hisaab`. Do not combine the production and dev Compose
files, run `down --volumes`, prune volumes or include PostgreSQL/Redis in a
routine `--force-recreate` command. Pulling a newer database image does not
upgrade a container kept by `--no-recreate`; handle database upgrades separately
after a backup/restore rehearsal. PostgreSQL major-version changes need a planned
migration, not just a new image tag on an existing data volume.

For an application-only rollback, confirm the older code is compatible with the
current schema and new data, acquire the same host lock, stop API/worker, and
restore the previous config and its SHA. Start that compatible release without
running migrations backward. Never restore a database over newer entries merely
to roll back application code. Environment files and persistent volumes must
survive either path. See [manual recovery](20-manual-recovery.md).

### Routine Checks

```bash
cd /opt/hisaab
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs --tail 100 api worker postgres redis
docker stats --no-stream
df -h
docker system df
```

Keep logs bounded and redact them before sharing. Set an external `/ready` uptime
check and an alert recipient; worker failures also need monitoring because the
API can remain ready while PDFs fail. Configure host disk/memory alarms and AWS
budget alerts. Investigate failed queues and growing disk usage before
they interrupt bookkeeping. Keep previous rollback images but remove older
unneeded image versions deliberately; never use blanket volume pruning.

For runtime env changes, edit only the relevant private file and recreate that
service. Restarting a container alone does not reload a changed Compose env file.
For frontend URL changes, rebuild the relevant frontend image. For dependency or
base-image security updates, rebuild and run the manual acceptance checks before
deployment; do not run package upgrades inside a live container.

### Backups and Release Record

There are three separate copies to maintain: database/queue storage, PostgreSQL
logical dumps, and the private R2 originals/thumbnails. The workflow creates a
local pre-migration dump; CI itself does not schedule daily backups, upload them,
or configure AWS snapshots. The existing worker now has an **opt-in** daily
PostgreSQL-to-R2 backup service at **02:00 Asia/Kolkata**, retaining the latest
verified archive. Its PostgreSQL 17 clients come from the official PGDG Debian
repository; the image does not install another database server.

Follow [Doc 30](30-postgres-r2-backup-and-ec2-migration.md#start-here-after-implementation-checks-pass)
for the separate private backup bucket, `BACKUP_*` settings, independent monitor,
and `node dist/backup.js initialize`, `status`, `run` and `adopt` operator commands.
Read [Doc 31](31-implementation-and-verification.md) for the actual acceptance
evidence and remaining owner checks. Leave `BACKUP_ENABLED=false` until enrollment,
replacement and restore checks pass for the intended bucket/host. No repository
scripts or additional backup service container are needed. The optional snapshots
and manual copies below provide separate recovery choices; they do not configure
or prove the daily R2 service.

#### Schedule EBS Snapshots in AWS

1. Identify the encrypted EBS volume containing Docker's data root and both
   named volumes. Tag that volume, for example `Backup=hisaab`. If data spans
   multiple volumes, include every data volume in a coordinated snapshot policy.
2. In **EC2 → Elastic Block Store → Lifecycle Manager**, create an EBS snapshot
   policy targeting that tag. Set a daily schedule, choose its timezone
   deliberately, and initially retain 14 daily snapshots. Check the created
   policy's permissions and enabled state; choose retention to match the amount
   of bookkeeping you can afford to lose and your storage budget.
3. Verify that the first scheduled snapshot reaches `completed`, then monitor
   policy failures and the age of the latest successful snapshot. Record the
   volume/snapshot IDs and how to access the encryption key after host loss.

AWS Data Lifecycle Manager schedules snapshot creation and retention; snapshot
storage still has a cost. Configure it in the console rather than adding a
repository backup script. [AWS Data Lifecycle Manager](https://docs.aws.amazon.com/ebs/latest/userguide/snapshot-lifecycle.html)

A snapshot of a running volume includes persisted blocks, not unsaved memory.
Without pausing writes, treat it as a crash-recovery point, not a coordinated
database/R2 backup. For a planned consistent full-volume snapshot, stop writers
and databases cleanly; AWS recommends stopping the instance for a root-volume
snapshot. Restore and validate an isolated copy before relying on scheduled
snapshots. [EBS snapshot considerations](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html)

#### Create and Copy a PostgreSQL Dump

Create an extra logical dump after important bookkeeping sessions and before
database maintenance. Run this on EC2; `set -e` prevents a failed command from
producing a completed `.dump` file. The lock avoids overlapping a deployment.

```bash
(
set -euo pipefail
umask 077
cd /opt/hisaab
exec 9>.deploy.lock
flock -n 9
test ! -e .deploy-in-progress
mkdir -p -m 700 backups
backup="backups/manual-$(date -u +%Y%m%dT%H%M%SZ).dump"
timeout --kill-after=10s 180s docker compose -f compose.prod.yml exec -T postgres pg_dump -U hisaab -d hisaab -Fc > "$backup.partial"
timeout 30s docker compose -f compose.prod.yml exec -T postgres pg_restore --list < "$backup.partial" > /dev/null
mv "$backup.partial" "$backup"
printf 'Completed: %s\n' "$backup"
)
```

`pg_dump` takes a consistent database snapshot while the app is running. Its
custom format includes schema and data, but not external R2 files, Redis jobs or
server configuration. An archive listing checks readability; an actual restore
is the proof of recovery. The pre-deployment procedure additionally stops writers
to establish the migration boundary.
[PostgreSQL dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html)

Copy each retained `.dump` outside EC2. One simple option is a private S3 bucket
with Block Public Access, encryption, versioning and a deliberate retention
policy. Install the standard AWS CLI on EC2 and give its instance IAM role access
only to the required bucket/prefix. Use role credentials rather than saving AWS
keys in app env files. Replace the two placeholders below; the file must be a
completed dump, not `.partial`.

```bash
(
set -euo pipefail
umask 077
backup=/opt/hisaab/backups/REPLACE_WITH_COMPLETED_FILENAME.dump
destination=s3://YOUR_PRIVATE_BACKUP_BUCKET/hisaab/postgres
test -s "$backup"
name=$(basename "$backup")
(cd "$(dirname "$backup")" && sha256sum "$name" > "$name.sha256")
aws s3 cp "$backup" "$destination/$name" --sse AES256
aws s3 cp "$backup.sha256" "$destination/$name.sha256" --sse AES256
)
```

The same transfer can be done from a trusted computer after downloading through
verified SSH. Keep filenames immutable, check both uploads succeed, then download
a copy and verify its SHA-256 before a restore drill. Remove old local dumps only
after their off-server copies and retention requirements are confirmed. The
copy commands are manual; daily DLM snapshots do not automatically create these
logical dumps. [AWS CLI copy reference](https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html)

#### Prove a Restore Away from Live Books

Use a separate disposable host with Docker and `/opt/hisaab-restore`. Copy the
reviewed production config and prepare private env files there; generate new
database passwords and use the application's matching release tag. Download one
trusted dump and its checksum into this directory. No live app, worker or device
should connect to this recovery target.

The example intentionally requires a new project/volume and starts PostgreSQL
only. Substitute the dump filename before running it on the recovery host:

```bash
(
set -euo pipefail
cd /opt/hisaab-restore
backup=REPLACE_WITH_DOWNLOADED_FILENAME.dump
sha256sum --check "$backup.sha256"
compose=(docker compose --project-name hisaab-restore --env-file .env -f compose.prod.yml)
if docker volume inspect hisaab-restore_postgres_data > /dev/null 2>&1; then
  echo "Use a fresh recovery target; an existing restore volume was found." >&2
  exit 1
fi
"${compose[@]}" up -d --no-recreate --wait --wait-timeout 120 postgres
"${compose[@]}" exec -T postgres pg_restore --list < "$backup" > /dev/null
"${compose[@]}" exec -T postgres pg_restore -U hisaab -d hisaab --no-owner --no-privileges --single-transaction --exit-on-error < "$backup"
"${compose[@]}" exec -T postgres psql -U hisaab -d hisaab -c "SELECT count(*) AS restored_tables FROM information_schema.tables WHERE table_schema = 'public';"
)
```

A zero exit status and table count are only structural checks. Complete the
[manual recovery checks](20-manual-recovery.md) for accounts, firm membership,
balances, stock, issued bills and attachment hashes. Use isolated storage/email
settings for any full app verification; do not point a drill's worker at live
R2 or production queues. Stop the recovery containers after the drill and retain
its evidence. Never restore over live books to test a backup.
Before admitting devices to a restored installation, set a new `RECOVERY_EPOCH`,
invalidate restored ephemeral authentication state, and reconcile pending saves
using [Doc 30](30-postgres-r2-backup-and-ec2-migration.md). Keep backup publication
disabled until the restored installation and its writer identity are accepted.
[PostgreSQL restore documentation](https://www.postgresql.org/docs/17/app-pgrestore.html)

Redis AOF survives normal container recreation. After database recovery or an
EC2/account move, start with fresh Redis and recreate only reviewed work, as
described in Doc 30. A SQL dump does not contain the queue. An EBS snapshot may
contain older Redis state, but restoring it is not permission to replay those
jobs: reconcile them against PostgreSQL's durable results before any deliberate
queue recovery. Never replay old queue state blindly or flush a live instance.

Keep independent private copies of R2 originals/thumbnails and protected
configuration/signing credentials. Preserve objects long enough to match retained
database recovery points; EBS snapshots do not include R2. A production cutover
needs an agreed recovery point and device reconciliation, following guide 20.

Keep a short private release record: commit/image SHA, config revision, migration
result, APK version/code/hash, manual checks, backup locations/restore outcome,
unresolved limitations and responsible contact. A simple document is enough.
