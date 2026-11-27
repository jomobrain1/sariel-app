# Notification recovery, pagination and Android location

This change prepares Android location sharing without building an APK or implementing Voice SOS. VPS deployment and scheduler setup remain separate.

## Notification recovery

New danger events carry pending notification work in the same MongoDB document as the incident. The existing request ID still identifies one incident. Failed fanout is retried by the registered `incident-notifications` job, with leases and backoff; retrying the original submission can recover it immediately.

Notifications store a durable channel plan before channel rows are created. The delivery job repairs unfinished plans. Stable channel IDs and insert-only updates preserve sent states and attempts. Emergency-contact alerts also use deterministic IDs so incident retries do not create new contact alerts.

No historical incidents are mass-replayed, and existing skipped/failed provider rows are not reset. That avoids unexpectedly sending old emergencies. Successful intake means the incident is saved, not that a recipient has read an email. Provider acceptance and acknowledgement remain separate. SMTP/SMS can still deliver more than once after an ambiguous provider timeout; this change does not claim exactly-once external delivery.

The Vercel entry's existing post-response delivery and protected job endpoint remain in place. No VPS scripts, cron entries or hosting changes are included. Deploy this API change so the new recovery job is available to those existing execution paths. Delayed retries still need the protected job endpoint to be called regularly on Vercel; registering a job alone does not create a serverless schedule.

## Pagination and location details

Notification pagination already existed. API results now include page number, page size and total pages, with stable ordering for tied timestamps. Web controls appear above the list and below longer lists; mobile controls show the total page count. Neither acknowledgement nor marking read removes a notification.

Reports can include a location capture timestamp and source. Older clients that only send coordinates still work. Alert map details now include the location source, capture time and accuracy. Last shared locations retain their original timestamp. Circle members without location permission receive no coordinates or map link. Email contains the full notification text; SMS remains subject to its existing length limit.

## Testing location now

1. Deploy the web/API changes first. The mobile URL remains `https://sariel-app.vercel.app/api`.
2. Restart Expo after installing dependencies in `mobile`.
3. Sign in, open Profile > Location sharing, and enable sharing on this phone. Grant foreground location permission.
4. Use Share current location; verify upload status and Recent locations. Check the coordinate timestamp and accuracy.
5. An accepted circle member with location permission should see the location; a member without it must not.
6. Disable sharing and confirm that no further points are uploaded. Clearing history stops sharing first.

Foreground sharing remains available in Expo Go. Android background sharing needs a future custom Android build; it cannot be verified in Expo Go. No APK or Expo prebuild was run for this change.

## Background location implementation and later device checks

The Android background task is defined at module scope and loaded from the root layout. Enabling background sharing requires a second, explicit disclosure, Android background permission and (on Android 13+) notification permission for the persistent indicator. On Android 11+ the user may need to choose Allow all the time in Settings. Declining leaves foreground sharing available.

The native foreground service displays a persistent notification. Location updates are best effort, approximately every five minutes, with OS scheduling and movement thresholds. Background mode continues when the app is backgrounded, but force-stop or killing the service can stop it; it is not an always-running or boot-start service.

Device consent is tied to the signed-in account and API host. Up to 100 unsent points are kept in private app storage with stable client IDs. Uploads retry on subsequent captures, including after process restart, using SecureStore session credentials. Sign-out, disabling sharing, revoked permission and invalid sessions stop or invalidate capture. The server continues to enforce sharing and circle permissions.

After a custom build is requested, test screen-off/background capture, foreground-service notification, permission revocation, offline/reconnect, sign-out, account switching and force-stop behavior. These have not been verified on Android hardware yet.

## Validation

```powershell
npm run build --workspace api
node api/tests/notification-recovery.mjs
node api/tests/phase-four.mjs
npm run build --workspace client
npm run lint --workspace client
cd mobile
npm run lint
npm run typecheck
npm test
```

API tests use an isolated local MongoDB database and a local fake delivery provider. No real contact is messaged. Mobile location tests use native-module adapters; they do not prove Android service behavior.

## Push only web/backend changes

Run from the repository root. These commands intentionally leave the untracked mobile project out of the commit and do not stage `.env` files.

```powershell
git status --short
git add -- api/src/circle/contacts.ts api/src/individual/status.ts api/src/notifications/engine.ts api/src/notifications/routes.ts api/tests/notification-recovery.mjs client/.env.example client/src/features/notifications client/src/features/safety/safety.api.ts client/src/features/safety/safety-dashboard.tsx docs/notification-location-updates.md
git diff --cached --stat
git commit -m "Fix alert recovery, notification pagination and location details"
git push origin main
```

Review the staged files before committing, especially if other work has been staged since these commands were prepared. No push has been performed by the assistant.
