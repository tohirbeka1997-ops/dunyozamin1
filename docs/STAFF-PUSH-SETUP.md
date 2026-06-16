# Staff mobile push notifications (FCM) setup

The staff mobile app includes a **device registration foundation** (`POST /v1/staff/devices/register`) but does **not** ship Firebase credentials in the repo. Complete these steps when you are ready to enable push.

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Create a project (or reuse an existing one).
3. Add an **Android** app and/or **iOS** app with the same package/bundle id as `sales-mobile/app.json`.

## 2. Download platform config

### Android

- Download `google-services.json`.
- Place it in `sales-mobile/` (or follow Expo’s [FCM guide](https://docs.expo.dev/push-notifications/fcm-credentials/) for EAS Build).

### iOS

- Upload your APNs key or certificate in Firebase → Project settings → Cloud Messaging.
- Download `GoogleService-Info.plist` if using native Firebase SDK.

## 3. Expo / EAS environment

Add to `sales-mobile/.env` (see `.env.example`):

```env
EXPO_PUBLIC_FCM_PROJECT_ID=your-firebase-project-id
EXPO_PUBLIC_FCM_API_KEY=your-firebase-api-key
EXPO_PUBLIC_FCM_APP_ID=your-firebase-app-id
EXPO_PUBLIC_FCM_MESSAGING_SENDER_ID=your-sender-id
```

For production builds, set the same values as EAS secrets.

## 4. Install client packages (when implementing push)

```bash
cd sales-mobile
npx expo install expo-notifications expo-device
```

Wire token registration on login using the existing API helper:

```ts
import { registerStaffDevice } from '@/api/client';
// registerStaffDevice(fcmToken, Platform.OS, deviceId)
```

## 5. Server-side send (future)

Today the API only **stores** FCM tokens in `staff_device_tokens`. To deliver pushes:

1. Add a Firebase Admin SDK service account JSON on the VPS (never commit it).
2. On `web_orders` insert/status change, enqueue a job that calls FCM HTTP v1.
3. Target tokens by `tenant` + `user_id` or topic per store.

## 6. Verify registration

After login, the app should call:

```http
POST /v1/staff/devices/register
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "fcm_token": "...",
  "platform": "android",
  "device_id": "optional-stable-id"
}
```

Integration test coverage exists in `public-api/staffCustomers.test.cjs` (device register section).

## Security notes

- Do not commit service account keys or `google-services.json` with production secrets to git.
- Rotate refresh tokens and invalidate device rows on logout if you add full push delivery later.
