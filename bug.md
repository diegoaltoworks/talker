# Bug: Twilio signature validation fails behind reverse proxy

## Problem

When running behind a reverse proxy (e.g. Google Cloud Run with a custom domain), Twilio webhook requests get a 403 because the signature validation URL doesn't match.

Twilio signs requests against the public URL: `https://bot.condescend.in/sms`

But `twilioSignatureMiddleware` (line 634 of dist/index.mjs) uses `c.req.url` when no `baseUrl` is provided. Behind Cloud Run's proxy, `c.req.url` resolves to `http://` (not `https://`), so the computed signature doesn't match what Twilio sent.

## Root Cause

In `src/middleware/twilio-signature.ts`:

```ts
function twilioSignatureMiddleware(authToken, baseUrl) {
  return async (c, next) => {
    // ...
    const requestUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}${c.req.path}` : c.req.url;
    // When baseUrl is not set, c.req.url behind a reverse proxy uses http:// instead of https://
    // Twilio signed against https://bot.condescend.in/sms but we're checking against http://...
  };
}
```

The middleware already supports `baseUrl` as a parameter, but it's not exposed through `TalkerConfig` or wired through `createTelephonyRoutes`.

In `src/routes/call/index.ts` (line ~1828):
```ts
app.use("/call/*", twilioSignatureMiddleware(deps.config.twilio?.authToken));
// ^^^ no baseUrl passed
```

Same in `src/routes/sms/index.ts` (line ~1904):
```ts
app.post("/sms", twilioSignatureMiddleware(deps.config.twilio?.authToken));
// ^^^ no baseUrl passed
```

## Fix

### 1. Add `publicUrl` to `TalkerConfig` in `src/types.ts`:

```ts
export interface TalkerConfig {
  // ... existing fields ...

  /** Public URL where webhooks are received (e.g. "https://bot.example.com").
   *  Required for Twilio signature validation behind reverse proxies.
   *  When not set, falls back to c.req.url which may use http:// behind a proxy. */
  publicUrl?: string;
}
```

### 2. Pass it through to the signature middleware

In `src/routes/call/index.ts`:
```ts
function callRoutes(deps, registry) {
  const app = new Hono();
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;
  app.use("/call/*", twilioSignatureMiddleware(authToken, baseUrl));
  app.post("/call", twilioSignatureMiddleware(authToken, baseUrl));
  // ...
}
```

In `src/routes/sms/index.ts`:
```ts
function smsRoutes(deps, registry) {
  const app = new Hono();
  const authToken = deps.config.twilio?.authToken;
  const baseUrl = deps.config.publicUrl;
  app.post("/sms", twilioSignatureMiddleware(authToken, baseUrl));
  // ...
}
```

Same for `src/routes/whatsapp/index.ts`.

### 3. Optionally fall back to chatter's publicUrl

In `createTelephonyRoutes` (`src/index.ts`), fall back to chatter's config:
```ts
// Resolve publicUrl: explicit config > chatter's publicUrl > undefined
const resolvedConfig = {
  ...config,
  publicUrl: config.publicUrl || chatterDeps.config.bot?.publicUrl,
};
```

## Consumer usage (davebot)

Once fixed, in `src/index.ts`:

```ts
await createTelephonyRoutes(app, deps, {
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    phoneNumber: env.TWILIO_PHONE_NUMBER,
  },
  publicUrl: "https://bot.condescend.in",
  transferNumber: env.TRANSFER_NUMBER,
  flowsDir: "./config/flows",
});
```

## Evidence

Twilio request inspector shows:
- Request URL: `https://bot.condescend.in/sms`
- HTTP status: 403
- Response body: empty (from `c.text("", 403)`)
- Response header `access-control-allow-origin: https://bot.condescend.in` confirms the request arrives with the correct host
- The `X-Twilio-Signature` header is present and valid for the public URL, but validation fails because the middleware computes against the wrong (http://) URL
