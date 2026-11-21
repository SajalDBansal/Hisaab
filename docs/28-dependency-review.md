# 28. Dependency Review

[Readiness audit](27-private-readiness-audit.md) | [Documentation index](README.md)

**Reviewed: 26 October 2026. G02 dependency repairs and exposure triage completed
locally, including a tested compatible decoder patch.** Registration remains open. Authentication,
registration and recovery endpoints must be assessed as internet-facing; having
one current user is not a security control.

## Audit evidence

The final unsuppressed `bun audit --json` ran at
**2026-10-26 13:04:59 +05:30** against the updated lockfile and exited **1**.

| Lockfile audit             | Critical | High | Moderate | Low | Total |
| -------------------------- | -------: | ---: | -------: | --: | ----: |
| Before updates, 26 October |        4 |    6 |       13 |   8 |    31 |
| After updates, 26 October  |        0 |    3 |        4 |   1 |     8 |

These are advisory/version-range matches, not demonstrated exploits. The original
31 matches include separate fast-uri 3.x and 4.x ranges for the same advisories.
The final eight matches are eight distinct advisory IDs across six package names.
Severity labels above are the registry labels returned by Bun.

Final `bun.lock` SHA-256:
`49f049120e0f3e85c09db005f9af31113b5fb4d2ca36fde31022bc8641d03b5d`.
Patch SHA-256:
`cb7da4cd5f44e86bda4f024f0aa204d4fe9673bac5958022199d801de659e5b2`.
Node **24.20.0** and Bun **1.4.0** were used. `.nvmrc` remains `24`; the existing
root/API/worker Node engine declarations now restrict the runtime to `>=24 <25`.
The existing Bun 1.4.0 declaration is unchanged.

The eight remaining registry matches divide by execution surface into **one client
package repaired by the local patch, two server dependency issues whose routes
are disabled in production, and five development/build-tool issues**. Bun still
reports the patched decoder's original version; its remaining match is not an
unrepaired recursive-decoding gate. This is source/dependency-path triage,
not the output of a production-only audit. Expo lists its CLI under dependencies,
and Swagger remains an API dependency even though its routes are disabled in
production. Package placement alone does not establish runtime reachability.

## Reviewed updates

| Dependency                     | Previous lock   | Updated lock    | Review and scope                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js and eslint-config-next | 16.3.3          | 16.4.1          | Aligned exact pins, including Next's platform packages. The [maintainer security release](https://github.com/vercel/next.js/releases/tag/v16.4.1) addresses the latest cache, image and Server Action findings; all eleven Next matches disappeared from the fresh audit.                                                                   |
| Fastify                        | 5.12.5          | 5.12.7          | Direct minimum raised to `^5.12.6` in API, worker and backend. Fixes [case-sensitive header-name validation](https://github.com/fastify/fastify/security/advisories/GHSA-389g-gv7q-r4x8). The [5.12.7 release](https://github.com/fastify/fastify/releases/tag/v5.12.7) remains on the same major.                                          |
| Zod 4                          | 4.6.5           | 4.6.7           | Direct minimum raised to `^4.6.6` in API, worker, native, backend and contracts. [4.6.6 checks constrained collection sizes before parsing elements](https://github.com/colinhacks/zod/releases/tag/v4.6.6); [4.6.7](https://github.com/colinhacks/zod/releases/tag/v4.6.7) preserves that fix. Better Auth resolves this patched copy too. |
| DOMPurify through jsPDF        | 3.4.16          | 3.4.17          | Same-major transitive repair within jsPDF's existing range. The [maintainer release](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) fixes the three reported sanitization issues.                                                                                                                                                 |
| fast-uri                       | 3.1.8 and 4.2.1 | 3.1.9 and 4.2.3 | Each existing major updated independently, including all nested AJV copies. The [maintainer advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg) identifies these patch lines. All eight range matches disappeared.                                                                                       |

No application source compatibility change was needed. No dependency was added,
no override was introduced, and Expo/React Native/React versions were retained.
The existing mismatch between the shared UI package's React Native version and
the app's version was not converted into an unrelated native-framework upgrade.

The initial audit-fix preview proposed switching some Zod 3 consumers to Zod 4
and downgrading esbuild 0.27.7 to 0.27.2. Those actions were not applied. After the
manifest updates, a second preview showed only the reviewed DOMPurify/fast-uri
repairs when those two advisories were excluded from the repair command. The
final audit above uses **no ignored advisories**; no suppression was saved.

### Runtime exposure addressed

- API route contracts and Better Auth now resolve Zod 4.6.7. Public signup/login
  is still exposed to untrusted input and requires the existing body limits,
  collection limits and rate limits. A dependency update does not prove that
  every route has an appropriate limit or that public-auth abuse is solved.
- The website uses App Router. Its icon returns static `ImageResponse` content;
  no attacker-controlled SVG input was found there. No `use cache`, Draft Mode
  or Server Action declaration was found in the website source. These facts
  narrow particular paths, but were not used as a reason to retain vulnerable
  Next.js. The [typed-array cache advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
  recommends upgrading even without the illustrated cache function.
- Sharp was already 0.35.5, satisfying the [Next image advisory's workaround](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).
  Next 16.4.1 now also requires that minimum. An image RCE was not reproduced.
- Current browser PDF paths in `print.web.ts` and `reportPdf.web.ts` render
  html2canvas output with `jsPDF.addImage`; they do not call `jsPDF.html` or
  configure DOMPurify's affected template/DOM modes. The transitive package was
  still patched. This observation is not a general assessment of HTML handling.

## Compatible decoder repair

The checked-in [decoder patch](../patches/decode-uri-component@0.2.2.patch)
backports the iterative UTF-8 scanner from the maintainer's
[0.5.0 security release](https://github.com/SamVerschueren/decode-uri-component/releases/tag/v0.5.0),
commit [a12fabaa](https://github.com/SamVerschueren/decode-uri-component/commit/a12fabaa28303cc8b5b07e93d128f4fc09fc31e5).
The package keeps its MIT license, 0.2.2 CommonJS export, type errors and
plus-to-space behavior. No ESM override, new dependency, Expo version change or
application link hook was introduced.

Valid input still uses native decodeURIComponent, including long Unicode values.
Malformed components up to **8,192 UTF-16 code units** use the iterative scanner
instead of recursive splitting. Longer malformed components remain literal after
plus-to-space normalization, avoiding the legacy fallback's repeated scans. Thus
an oversized malformed value may remain percent-encoded instead of being partly
decoded. The upstream percent-separator correction is also retained: malformed
bytes cannot recombine across a decoded percent sign into another decoding pass.

The root manifest records the patch with Bun's built-in
[patchedDependencies mechanism](https://bun.com/docs/pm/cli/patch). The patch file
must accompany package.json and bun.lock before installation. The current
Dockerfiles copy the full context before installing, and .dockerignore does not
exclude patches. Rebuild client artifacts with Metro's cache cleared; previously
built exports and APKs do not acquire a patch merely because the source tree did.

Verification after applying the saved patch:

- **140 decoder checks** passed: maintainer valid/malformed UTF-8 vectors adapted
  only for legacy plus semantics, type errors, long input and limit boundaries.
  Synthetic malformed inputs of 8,191/8,192/8,193/1,000,000 characters completed;
  the million-character input completed in under 1 ms on this machine. These
  local timings are observations, not a device performance guarantee.
- **11 installed core parser/query scenarios** passed through the patched
  query-string dependency: Unicode, repeated/null/empty parameters, HTTPS and
  hisaab URI forms, malformed bytes, two 300,000-character malformed queries and
  subsequent normal navigation. They use the actual parser after scheme removal,
  not OS deep-link delivery or a mounted phone UI.
- **7 primary Expo fork query-parser scenarios** separately passed for URI forms,
  Unicode, malformed encoding, duplicate fields, large input, a subsequent valid
  query and fragments. This fork uses URLSearchParams; it was not changed.
- A disposable project installed the existing query-string/decoder chain from a
  **private empty cache**, applied the checked-in patch, passed a frozen reinstall,
  and preserved legacy plus handling, long Unicode and mixed/large malformed
  queries. This establishes persistence beyond the edited workspace copy.
- The existing native **typecheck and lint both passed** after the patch.

All temporary reference files, the disposable installation and its cache were
removed. No testing framework or retained harness was added. The patch metadata
is the **only lockfile change** since the earlier server-build freeze: removing
that metadata reproduces SHA-256
0b580c99423c7546842927ee048320e5186200c74948467ff77cc936b442da6b exactly.
All package versions, including Better Auth 1.7.7, remain unchanged by this repair.

## All remaining registry matches

The versions and ancestry below come from the final lockfile and installed code.

| Advisory and registry severity     | Remaining version / path                                                                                           | Concrete exposure and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GHSA-vcc3-ghjq-m6fr - moderate** | `decode-uri-component@0.2.2`, through `expo-router@57.0.28 -> query-string@7.1.3`                                  | **Repaired locally with the checked-in Bun patch below.** The bundled React Navigation core parser uses query-string; Expo's primary linking fork uses URLSearchParams. The original report overstated the main linking path's reachability. The patch removes the recursive decoder for every caller and bounds malformed fallback input. The [maintainer advisory](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr) remains a raw version match because the compatible patched package stays at 0.2.2.                                                                                                                                                         |
| **GHSA-8pvw-jcv7-9cmj — moderate** | `@fastify/static@9.3.0`, through `api -> @fastify/swagger-ui@5.2.6`                                                | Installed server dependency; production routes disabled by `apps/api/src/app.ts`. The [advisory](https://github.com/fastify/fastify-static/security/advisories/GHSA-8pvw-jcv7-9cmj) concerns noncanonical paths bypassing `allowedPath`. Hisaab does not configure that guard or use this plugin for private document storage. Keep API docs/dev mode off public interfaces; a deployment that enables them requires renewed assessment.                                                                                                                                                                                                                                                                        |
| **GHSA-83w8-p2f5-377r — high**     | Same `@fastify/static@9.3.0` path                                                                                  | Same production boundary. The [advisory](https://github.com/fastify/fastify-static/security/advisories/GHSA-83w8-p2f5-377r) concerns route guards bypassed by traversal inside static paths. Hisaab's Swagger setup serves UI assets rather than guarded business files. Production absence of `/docs` and `/docs/static/*` must still be checked on the deployed API.                                                                                                                                                                                                                                                                                                                                          |
| **GHSA-67mh-4wv8-2f99 — moderate** | `esbuild@0.18.20`, through `drizzle-kit@0.31.11 -> @esbuild-kit/esm-loader@2.6.5 -> @esbuild-kit/core-utils@3.3.2` | Development/migration-generation tooling. The [advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99) affects esbuild's HTTP serve feature; the application scripts use compilation/loaders, not that server. Do not run this vulnerable serve feature, even on loopback: a malicious webpage can read its responses. It is not a flaw in the emitted server bundle.                                                                                                                                                                                                                                                                                                               |
| **GHSA-g7r4-m6w7-qqqr — low**      | `esbuild@0.27.7`, through `tsup@8.5.1`                                                                             | Build tooling. The [maintainer advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr) requires the Windows development server with `servedir`. Existing tsup configs do not enable it. No esbuild downgrade or tsup major upgrade was made solely to remove this audit match.                                                                                                                                                                                                                                                                                                                                                                                                      |
| **GHSA-86w9-cpqp-85rv — high**     | `node-forge@1.4.0`, through Expo CLI and `@expo/code-signing-certificates@0.0.6`                                   | Tooling/signing verification. The fresh audit reports acceptance of extra nested DigestAlgorithm elements during RSA verification. Installed Expo certificate code does call `certificate.verify` and `publicKey.verify`, so do not treat it as unused within signing tools. It is not on the API auth path; no expo-updates/code-signing runtime integration was found in this app. Restrict signing inputs to controlled certificates/keys. Audit-fix reported no published fixed version; the [official package metadata](https://registry.npmjs.org/node-forge/latest) still reported 1.4.0 on this date. The attempted maintainer-advisory URL returned 404; no independent exploit validation is claimed. |
| **GHSA-w5hq-g745-h8pq — moderate** | `uuid@7.0.3`, through Expo's `xcode@3.0.1` tooling                                                                 | Native project generation. The [maintainer advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) concerns v3/v5/v6 calls with caller-provided output buffers. Installed xcode uses `uuid.v4()` without such buffers. API/backend/worker use unaffected uuid 14.0.2. Do not force a new UUID major into Expo's xcode dependency.                                                                                                                                                                                                                                                                                                                                                     |
| **GHSA-mrhx-c7xc-m3w5 — high**     | `zod@3.25.76` under `@expo/cli@57.0.31` and `eslint-plugin-react-hooks@7.1.1`                                      | Development/CLI/lint validation, not the public API's Zod instance. Oversized constrained collections can consume memory; process trusted project/config input only. Expo CLI still requires Zod 3, whose latest stable release remains 3.25.76. The [maintainer's collection fix](https://github.com/colinhacks/zod/releases/tag/v4.6.6) is on Zod 4. No cross-major transitive override was applied.                                                                                                                                                                                                                                                                                                          |

Registry checks found that the latest Expo Router **57.0.29** still depends on
query-string `^7.1.3`, so merely advancing the current SDK's patch version does
not repair the decoder. Swagger UI **5.2.6** still requires static `^9.1.2`;
tsup **8.5.1** still requires esbuild `^0.27.0`; drizzle-kit **0.31.11** retains
the old loader. Upgrading a parent to a different major needs a separate
compatibility review, rather than forcing a transitive version.

## Checks completed

| Check                              | Result and limit                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`    | Passed: 1,302 installs checked across 1,405 packages, no changes. Lockfile ready for Linux/integration builds.                                                                                                                                       |
| Installed module resolution        | API and Better Auth both use Zod 4.6.7; Fastify 5.12.7, Next 16.4.1, DOMPurify 3.4.17 confirmed.                                                                                                                                                     |
| `bun run --cwd apps/web typecheck` | Passed with Next 16.4.1, including route type generation. No website source edit required.                                                                                                                                                           |
| Focused Node 24 checks             | Zod array/set/map size limits reject before item transforms; valid arrays retained. Fastify header deny rule rejects three casing variants. Fastify/Zod accepts/serializes a valid body and rejects oversized/wrong-type bodies.                     |
| Focused URI/PDF/image checks       | fast-uri 3.x and 4.x keep an encoded dangerous scheme inert and preserve an ordinary HTTPS URL. jsPDF raster `addImage` generates PDF bytes. Sharp encodes/reads a synthetic JPEG. These are not browser pagination or phone-share acceptance tests. |
| Final audit                        | Eight matches, exit 1, no suppressions; timestamp and fingerprint above.                                                                                                                                                                             |

Checks used temporary shell input and a disposable patch-installation directory.
No permanent harness, test framework, root scripts folder, database mutation or
cloud operation was added. The integration owner reports **all seven root
typechecks, all seven lint tasks and all four builds passed** on the updated
dependency versions before the decoder-only patch. Native typecheck/lint then
passed again after that patch. The integration owner also reports 85 API auth
checks passed with unchanged Better Auth 1.7.7. Expo web export, Linux image
verification and deployed acceptance are recorded by the integration workstream;
the focused checks here do not claim those remaining checks passed.

## Remaining release work

1. **Ship the patched client artifacts.** Install with the checked-in patch,
   rebuild/export with Metro's cache cleared and retain the patch in reproducible
   build inputs. Replace it only when a compatible upstream dependency eliminates
   the finding; rerun valid/malformed query checks when changing that dependency.
2. **Verify production boundaries.** Keep `NODE_ENV=production`; verify Swagger
   routes and development/tool servers are unavailable publicly. Run API and
   worker build outputs rather than development servers. Public registration
   and authentication still need their own rate-limit, input-bound and abuse
   checks; owner-only assumptions are not permitted.
3. **Verify deployed artifacts and the phone build.** Root checks and the
   post-patch native checks passed as recorded above. The integration pass also
   completed a fresh Expo web export, all four Linux image builds and real queued
   PDF output; see [G04's runtime evidence](27-private-readiness-audit.md#g04--local-runtime-verified-deployment-remains).
   An APK build, deployed acceptance and OS deep-link delivery on a phone remain.
4. **Track the five tool findings.** Revisit compatible Expo, drizzle-kit and
   tsup releases and node-forge's fix. Any new remote signing/verification use,
   untrusted build input or esbuild serve use invalidates the current deferral.
   Re-run an unsuppressed audit before release and after dependency changes.

No zero-vulnerability claim or blanket production security approval is made.
