# Hisaab Product Website

The public Next.js website, separate from the business application. It needs no
database connection or API credentials. Use Node 24 and Bun 1.4.0; run the commands
below from the repository root with workspace dependencies installed.

```sh
bun run --cwd apps/web dev
```

Open <http://localhost:3002>.

The 12 pages are home (`/`), `/features`, `/help`, `/system`, `/architecture`,
`/accounting-principles`, `/privacy`, `/security`, `/about`, `/contact`,
`/get-started` and `/downloads`.

## Public Configuration

Use `apps/web/.env.local` for local development, following `.env.example`, or set
these environment variables before building:

| Variable                            | Value                                                             |
| ----------------------------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`              | The deployed product website URL.                                 |
| `NEXT_PUBLIC_APP_URL`               | The actual business application URL.                              |
| `NEXT_PUBLIC_SUPPORT_EMAIL`         | The operator's monitored support email address.                   |
| `NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL` | Optional approved Android release manifest URL. Blank by default. |

Leave unavailable values blank; no live URLs or mailbox are assumed. Configure
the real URLs and email before release. These values are public and embedded at
build time, so changes require a rebuild. Do not put secrets in them.

The product website is `https://hisaab.sajaldbansal.com`, and the accounting app is
`https://app.hisaab.sajaldbansal.com`. Support/privacy contact is
`sajaldutt.bansal@gmail.com`. Use the same values in the deployment's build-time
environment so app links, canonical URLs and the sitemap use the correct origins.
The API origin is `https://api.hisaab.sajaldbansal.com`; this product website does
not call it or need an API environment variable.

## Android Downloads

`/downloads` fetches release metadata on the server. Set
`NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL=https://downloads.hisaab.sajaldbansal.com/approved/latest.json`
only after the release process has published an approved manifest. Leave it blank
for development or when downloads are unavailable. An unset, invalid, unreachable
or malformed manifest renders an unavailable message with no APK link. An example
URL in configuration does not indicate that a release is live.

The explicit trusted origin is `https://downloads.hisaab.sajaldbansal.com`, defined
in `lib/download-manifest.ts`. Configuration cannot widen that trust boundary.
Manifest URLs must be canonical HTTPS URLs on that origin with a simple `.json`
path, without credentials, query strings, fragments or redirects. APK URLs must
match `/android/<version>/<buildNumber>/hisaab.apk` on the same origin exactly.
Versions are 1-64 ASCII letters, digits, dots, underscores, pluses or hyphens,
starting with a letter or digit. The release contract is:

```json
{
  "schemaVersion": 1,
  "version": "1.2.3",
  "buildNumber": 42,
  "publishedAt": "2026-10-19T12:30:00.000Z",
  "android": {
    "url": "https://downloads.hisaab.sajaldbansal.com/android/1.2.3/42/hisaab.apk",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "sizeBytes": 35651584,
    "packageName": "com.sajaldbansal.hisaab"
  }
}
```

This is illustrative metadata, not a published release. Build number and byte
size must be positive safe integers; the checksum must be 64 hex characters and
the publication timestamp must be ISO format with a timezone. Serve manifests as
`application/json`. Requests have a 5-second timeout (including the response body)
and a 16 KiB limit, enforced while reading even without a reliable Content-Length.
No cookies, authorization headers or user-provided destinations are forwarded.

The server bypasses Next's fetch cache and keeps one bounded in-memory result per
process: valid releases for 60 seconds, failures for 15 seconds. Concurrent reads
share a request. After expiry a failed refresh replaces the old release with the
unavailable state; stale download links are not retained. The page uses request-time
rendering, so builds do not contact the downloads host. Publishing a manifest needs
no site rebuild, but changing any public environment variable does.

Only metadata is fetched. The site neither proxies APKs nor verifies their signing
certificate. The visible checksum is for file integrity comparison and must not be
presented as proof of the signing identity. APKs are Android-only; the browser app
is the alternative for iOS. Release signing, APK verification and storage
publication are manual responsibilities; this repository does not publish them.

## Manual Build

```sh
bun run --cwd apps/web build
bun run --cwd apps/web start
```

The local production server also uses port 3002. The app-scoped `turbo.json`
includes all four public settings in the build cache key and passes them through
to dev. Pass the same values to the production build. Do not add credentials to
these public settings or to the Turbo cache inputs.

With the site running, manually check navigation, help links and downloads at
mobile and desktop widths. Confirm unavailable downloads show no APK link and
configured releases show the expected destination and checksum.

Content lives in `content/`; reference pages share `components/article-page.tsx`.
The site shell and small interactive controls live in `components/`. Design tokens
and responsive rules are in `app/globals.css`, matching the native theme without
bundling React Native or its data layer into the public website.

## Release Notes

The privacy page is provisional. The deployment operator must supply its identity
and complete legal review before publishing it as a final privacy policy.
Unconfigured site origins produce a `noindex` notice and blocked robots policy.
Set the real root origin (no path or query) before enabling public search indexing.
See [asset provenance](public/images/README.md) for screenshots and font licensing.
