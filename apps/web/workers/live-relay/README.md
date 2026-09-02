# 2MRRW live relay

This is the always-warm media path used by the browser broadcast studio:

`browser WebRTC/WHIP -> MediaMTX -> local FFmpeg H.264/AAC -> Twitch RTMPS`

The relay accepts one publisher on the exact `2mrrw-live` path. Publish access
is delegated to the platform's short-lived HMAC grant endpoint. RTSP is bound
inside the Machine only and is not exposed by `fly.toml`.

## Production setup

From this directory:

```sh
fly apps create 2mrrw-live-relay
fly secrets set LIVE_RELAY_TOKEN_SECRET='<same 32+ byte value configured in Vercel>' LIVE_RELAY_SERVICE_SECRET='<same dedicated relay-service value configured in Vercel>'
fly deploy
```

Set these production variables on the Vercel `artist-platform` project:

```text
LIVE_RELAY_PUBLISH_BASE_URL=https://2mrrw-live-relay.fly.dev
LIVE_RELAY_TOKEN_SECRET=<same value as Fly>
LIVE_RELAY_SERVICE_SECRET=<same dedicated relay-service value as Fly>
TWITCH_OAUTH_TOKEN_ENCRYPTION_KEY=<64 hex characters encoding 32 random bytes>
```

Do not configure a Twitch stream key in Fly or Vercel. In the production
Broadcast Studio, choose **Authorize Twitch** and approve the channel through
the Twitch sign-in link. The platform encrypts the OAuth tokens at rest and the
relay requests an ingest destination server-to-server when publishing starts.

The Machine must remain warm (`auto_stop_machines = false` and
`min_machines_running = 1`) so pressing **Go Live Now** does not wait for a
cold boot. Twitch's stream key is fetched only into the relay process after an
authorized publish starts; it never becomes a Fly/Vercel setting or reaches a
client bundle or browser.
