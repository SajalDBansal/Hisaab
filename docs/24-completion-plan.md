# 24. Completion Plan

[Documentation index](README.md)

Originally reviewed on 20 October 2026; updated during G-phase work on 26 October.
The Docker and GitHub Actions files now exist. This guide retains the phased
rollout order; use [guide 27](27-private-readiness-audit.md) for actual verification
results. A supplied workflow does not mean cloud deployment has been completed.

**Latest review:** follow [Doc 29](29-system-audit-and-work-plan.md) for additional
open application/infrastructure defects before finishing this rollout. The
requested daily PostgreSQL-to-R2 backup and migration to another EC2/account have
their own detailed plan in [Doc 30](30-postgres-r2-backup-and-ec2-migration.md).
They originated in an audit-only pass. Current implementation and acceptance are
tracked in [Doc 31](31-implementation-and-verification.md). Publication remains
disabled until the operator configures and verifies the dedicated backup bucket.

**Current scope update, 26 October 2026:** one person uses the installation today,
but normal registration and multiple users/firms remain supported.
Use [the private-use audit](27-private-readiness-audit.md) for the expanded defect
list and repair order before this deployment plan. The public website and public
APK distribution below are optional; authenticated firm isolation and reliable books,
documents and recovery are required.

## Read These Three Guides

1. This guide: what remains, in implementation order, with a finish condition for
   each phase.
2. [Docker and CI/CD](25-docker-and-cicd.md): the supplied files and how each works.
3. [EC2 and Expo deployment](26-ec2-and-expo-deployment.md): owner setup, first
   deployment, Android publication, updates and recovery.

Keep existing feature guides for business rules. Do not rebuild the application
or recreate a general-purpose deployment framework.

## Target Setup

```text
GitHub -> check types -> build four images -> Docker Hub -> SSH deployment

Internet -> EC2: Caddy HTTPS
                 |-- hisaab.sajaldbansal.com     -> website:3002 (Next.js)
                 |-- app.hisaab.sajaldbansal.com -> app:80       (Expo web)
                 |-- api.hisaab.sajaldbansal.com -> api:3000     (Fastify)
                 `-- worker                    -> background jobs, no public port

API + worker -> PostgreSQL + Redis containers on EC2 -> persistent data volumes
API + worker -> private R2 documents
API          -> Resend email
Android APK  -> separate public R2 bucket -> downloads.hisaab.sajaldbansal.com
```

This is a single-machine deployment with brief downtime during upgrades. It is
not high availability. Separating the worker makes ownership and restarts clear,
but all four applications still share the EC2 CPU and memory.

## What Already Exists

| Area                  | Existing implementation                                                        | Still required                                                         |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| API                   | Production image, bounded readiness, initialization, auth and migration checks | Deployed HTTPS/cookies and internal-database acceptance                |
| Worker                | Separate image, schedules, sandboxed PDF/reminder/cleanup checks               | Repeat on EC2 with PostgreSQL/Redis containers                         |
| Public website        | Patched Next.js, production image and validated APK manifest reader            | Deployed content, DNS and download publication                         |
| Signed-in browser app | Explicit Expo SPA image, production URLs, login and decoder patch              | Deployed browser/device acceptance                                     |
| Android               | Application ID, EAS `direct` APK and `production` store profiles               | Owner/project, signing, real-device acceptance and publication         |
| Accounting            | Bookkeeping features plus locally verified F01-F18 repairs                     | Apply migrations to intended books and complete release acceptance     |
| Recovery              | Firm export and an isolated PostgreSQL/object restore rehearsal                | Retained encrypted backups, EC2 snapshot restore and device cutover    |
| Delivery              | Four Dockerfiles, Compose/Caddy and GitHub workflow supplied; no root scripts  | Configure providers/secrets and perform EC2 acceptance in guides 25-26 |

Existing code is not evidence that a production environment works. A source
review cannot verify a provider's credentials, TLS configuration, phone behavior
or the accuracy of an accountant's example books.

## Phase 1: Correct Known Application Gaps

Owner: implementation work. Make small changes following the existing module
boundaries; no broad refactor or new framework is needed.

**26 October update:** the four corrections below have been implemented and
checked locally as F08, F09 and F16 in [Doc 27](27-private-readiness-audit.md).
Keep their acceptance scenarios for the deployed environment; follow the audit's
remaining private-release gates before moving to internet hosting.

| Change                                                         | Where to start                                                                                                                                                                                 | Manual acceptance                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Include imported opening bills in notification/reminder reads  | [notifications repository](../packages/backend/src/modules/notifications/notifications.repo.ts), reuse [opening-bill loader](../packages/backend/src/modules/imports/imports.opening-bills.ts) | Import bills with different due dates, partially pay one, fully pay another. Reminders must agree with outstanding-bill amounts and dates.                                                                  |
| Map the `P0021` import guard to a useful 409 conflict          | [book error mapper](../apps/api/src/lib/book-errors.ts), [sync service](../apps/api/src/modules/sync/sync.service.ts)                                                                          | A protected imported-master change through HTTP and sync retains the original record and returns `IMPORTED_OPENING_IMMUTABLE`, not a generic 500.                                                           |
| Bound API readiness checks and database connection/query waits | [system routes](../apps/api/src/modules/system/system.routes.ts), [server](../apps/api/src/server.ts), [database client](../packages/backend/src/db/client.ts)                                 | Interrupt PostgreSQL and Redis separately in disposable staging. Readiness returns 503 within five seconds and recovers after reconnection. Bound the underlying operation too, not only a timer around it. |
| Exclude `/health` and `/ready` from ordinary request quotas    | [system routes](../apps/api/src/modules/system/system.routes.ts), [rate limiter](../apps/api/src/plugins/rate-limit.ts)                                                                        | Even after exhausting the ordinary quota, health is 200 and readiness is 200/503, not 429. Keep authentication limits in place.                                                                             |

Also inspect the unused `@repo/ui` dependency in
[native package.json](../apps/native/package.json). No application source import
was found during this review, and [the starter UI package](../packages/ui/package.json)
uses different React Native versions. Remove the dependency/workspace only after
confirming it has no consumers, then update the lockfile. This is build hygiene,
not a proven cause of a mobile crash.

Finish when: the four scenarios pass on sample data, `bun run typecheck` passes,
and no financial-history or access-control behavior has been weakened. These
checks can be manual; this plan does not reintroduce a regression-test pipeline.

## Phase 2: Package the Services

Owner: implementation work, following [guide 25](25-docker-and-cicd.md).

- Keep the four Dockerfiles, three Compose files, Caddy, Nginx and Chromium policy
  in [deployment](../deployment/README.md). Root `.dockerignore` remains the build filter.
- Development Compose contains only PostgreSQL/Redis. Local Compose builds the
  app containers; production Compose runs published images and persistent
  PostgreSQL/Redis containers on EC2.
- Reuse existing builds and production entry points. Keep API and worker separate.
- Include API migration files and runtime dependencies, not just compiled JS.
- Install Chromium/fonts in the worker, run it non-root and retain its sandbox.
- Keep the supplied Chromium seccomp profile beside Compose; copy it during deployment.
- Set Expo `web.output` explicitly to `single`; preserve existing native settings.
- Keep public browser values at build time and server secrets at runtime.
- Use restart policies, health checks, bounded logs and worker shutdown grace.

Finish when: clean Linux images build from the lockfile without local env files
or Windows dependencies. A disposable database can be migrated twice safely
using the API image. Containers run production commands, not development servers.

## Phase 3: Prepare Owner Accounts and Services

Owner: you, using [the deployment guide](26-ec2-and-expo-deployment.md).

- Generate the two database passwords for production Compose and keep them in
  EC2's private `.env`. PostgreSQL/Redis run on its internal Docker network.
- Enable scheduled storage snapshots, retain database dumps outside EC2, and
  choose an independent private file backup with a tested restore procedure.
- Configure the private document bucket, CORS, credentials and verified email.
- Create four Docker Hub repositories and separate push/pull credentials.
- Prepare AWS, DNS and an Expo project. Keep the release bucket separate from
  private business documents.

Finish when: credentials are stored outside Git, providers support the required
connections/privileges, and backup ownership and retention are written down.

## Phase 4: Verify Production Containers Locally

Owner: implementation work with owner-supplied staging service configuration.

Build the real images. Point them at disposable sample books, not business data.
Use the supplied local Compose file for an HTTP preview; its API/worker use
development settings. The deployment README explains adding the dev dependency
file or configuring external services. Ports bind to `127.0.0.1`. This preview
does not verify production environment restrictions or HTTPS authentication.
Use an HTTPS staging origin for full browser authentication checks; local
loopback health checks alone do not verify cookies or CORS. Do not weaken the
production origin validation to make a local test pass.

Check all four services, migration execution, worker readiness, a completed PDF,
an image upload with thumbnail, and process restart. Exercise the documented
[first workflow](04-real-workflow.md), including report totals after restart.
Stop a worker during a job and confirm recovery without duplicate financial work.

Finish when: logs have no unexplained failures, PDF sandboxing works on Linux,
and a fresh phone/browser can reach the configured API. Local success still does
not replace the HTTPS and native-device checks after EC2 deployment.

## Phase 5: Add the Small CI/CD Workflow

Owner: implementation work, with GitHub/AWS secrets supplied by you.

Use one workflow with three jobs: `check`, `publish`, `deploy`. Type-check and
build, push four images to Docker Hub, then deploy that exact commit to EC2 over
SSH. No large test suite, custom shell/JS files, artifact framework or remote
source build is needed. Keep the first deployment manual; enable CD afterward.

Finish when: failed checks prevent publication, failed publication prevents
deployment, and only an approved `main` release can touch production. A failed
migration must stop the rollout. The SSH ingress rule must not remain public.

## Phase 6: Deploy EC2 and Verify HTTPS

Owner: you, following [first deployment](26-ec2-and-expo-deployment.md#phase-6-first-deployment).

Install Docker/Compose, configure the three server domains, place private env
files on EC2, pull the chosen images, run migrations once, then start Compose.
Verify the real hostname, proxy IP handling, login/device transfer and private
downloads. Reboot EC2 and confirm the services return without an open SSH shell.

Finish when: all seven containers are healthy, external readiness works, no internal
ports are public, and the complete workflow passes against staging/sample books
in the intended production topology.

## Phase 7: Publish Android

Owner: you, with implementation help only for any discovered configuration bug.

Link the existing EAS config to your Expo project, preserve the signing key and
build the `direct` Android APK. Test it on a real phone with Metro stopped. Upload
the approved APK and manifest to the public release bucket, then enable the
website download link. See [Android publication](26-ec2-and-expo-deployment.md#phase-7-android-release).

Finish when: installation and upgrade both work, the package identity is correct,
and camera, gallery, sharing, authentication and offline/reconnect checks pass.
An Android APK is not an iOS release. Defer iOS store delivery until its bundle
identifier, Apple account and signing/submission work are separately completed.

## Phase 8: Accept the Release and Operate It

Owner: you, with an accountant or knowledgeable bookkeeper for financial samples.

Complete [the release checklist](23-release-checklist.md). Include GST/non-GST
split sales, returns, journals, loans with reviewed interest, commissions,
allocations, locks, roles and firm isolation. Browse the website and signed-in
app at desktop and phone widths. Validate actual financial totals, not just
whether a page opens.

Record the commit/image tag, migration result, deployed env version, APK build,
backup restore evidence and accepted limitations. Configure external uptime and
disk/CPU alerts with a recipient. Test one ordinary update and one compatible
image rollback before relying on CD.

Finish when: there are no unresolved release-blocking findings, a fresh private
restore has been demonstrated, and someone owns alerts, updates and backups.
This is a release gate, not a promise that all future bugs have been eliminated.

## Deliberately Not Included

- Kubernetes, Terraform, blue/green deployments, multiple worker replicas,
  production database/Redis containers, PM2 or a root `scripts/` directory.
- Automated tax filing, multilingual support or a new accounting engine.
- A new offline website-shell/service-worker system. Cold browser opens/reloads
  still need internet; test offline work in an already loaded app and native app.
- Automatic message delivery merely because reminder preparation runs.
- Treating a firm JSON export as a complete database-and-document backup.
- OTA app updates or an iOS store release in the first Android/web deployment.

The next implementation task is **Phase 1**, followed by packaging. Do not begin
with another large codebase refactor or claim that creating Dockerfiles alone
makes the financial system production-ready.
