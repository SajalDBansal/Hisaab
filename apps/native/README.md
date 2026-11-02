# Native

A [react-native](https://reactnative.dev/) app built using [expo](https://docs.expo.dev/)

## Local API

Start the API on `0.0.0.0:3000`, then start Expo in LAN mode. The app derives the API host from Expo's LAN address, so a phone on the same Wi-Fi should call `http://<your-computer-ip>:3000`.

If the API uses another port (for example `PORT=3010`), set `EXPO_PUBLIC_API_PORT=3010`
in `.env.local` instead of pinning a full URL; the host keeps following Expo's LAN
address when your router assigns a new IP. Also add `http://<your-computer-ip>:8081`
to the API's `TRUSTED_ORIGINS` and point its `BETTER_AUTH_URL` at the LAN address.

If auto-detect does not work, copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` manually.

Signed-in sessions use real API data. Keep `EXPO_PUBLIC_REQUIRE_LOGIN=true`;
setting it to `false` explicitly selects the in-memory demo. Restart Expo after
environment changes.

See [the real workflow checklist](../../docs/04-real-workflow.md) for connected
screens, manual restart checks and links to related feature guides.

## Browser Export

From the repository root, configure `EXPO_PUBLIC_API_URL` for the intended API,
then export the signed-in browser app:

```sh
bun run --cwd apps/native export:web
```

This runs standard `expo export --platform web` and writes `apps/native/dist`.
New builds require network access to open or reload in a browser. An already
loaded app can use its existing encrypted read cache and queue supported writes;
native offline use remains subject to its access and storage limits. See
[offline books](../../docs/17-offline-books.md) for details.

## Manual Expo Builds

`eas.json` and `app.config.js` retain the manual Expo build settings. With the EAS
CLI installed and authenticated, set `EXPO_PROJECT_ID` and `EXPO_OWNER` for your
Expo project, or supply the corresponding app configuration. Release profiles
require `https://api.hisaab.sajaldbansal.com` and login enabled.

Run from `apps/native`:

```sh
eas build --platform android --profile direct
# Store builds, when needed:
eas build --platform android --profile production
eas build --platform ios --profile production
```

The Android identity is `com.sajaldbansal.hisaab`. `direct` produces an APK;
`production` produces an Android App Bundle or an iOS store build. Preserve signing
credentials and review the resulting build before distributing it. Build signing,
store submission and publication are manual responsibilities.

Public Android downloads must use storage separate from private customer files.
The [website README](../web/README.md#android-downloads) describes the metadata it
accepts; no download link appears until a valid manifest is available.
