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

## Owned host (2MRRW-Cloud)

The same image and `mediamtx.yml` run on any Docker Compose host. Fly's proxy
is replaced by Caddy (automatic HTTPS), and the host's name comes from
`live-relay.env` as MediaMTX `MTX_*` overrides — nothing in the image changes.

```sh
cp live-relay.env.example live-relay.env && chmod 600 live-relay.env   # set the domain and the secret
docker compose up -d --build
curl -s -o /dev/null -w '%{http_code}\n' https://live.2mrrw.com/2mrrw-live/   # 200
```

The host needs a DNS record for `LIVE_RELAY_DOMAIN` and open TCP 80/443
(certificate and WHIP) and UDP + TCP 8189 (WebRTC media). Caddy's volume only
holds its certificate; a new host simply issues its own.

Verified in the Mac's Lima VM (arm64): HTTPS page 200, WHIP `OPTIONS` 204, an
RTSP test publish accepted on `2mrrw-live`, and the Twitch hook started (and,
without a service secret, refused with exit 78 before contacting anything).

### Cutting over from Fly (never during a broadcast)

1. Bring the host up as above with a **new** `LIVE_RELAY_SERVICE_SECRET`
   (Fly's and Vercel's copies cannot be read back).
2. On Vercel `artist-platform`: `LIVE_RELAY_PUBLISH_BASE_URL=https://<LIVE_RELAY_DOMAIN>`
   and the same new `LIVE_RELAY_SERVICE_SECRET`; redeploy.
3. Broadcast Studio → Go Live Now: confirm the stream reaches Twitch, then end it.
4. Stop the Fly app (`fly scale count 0 -a 2mrrw-live-relay`).

Rollback: point `LIVE_RELAY_PUBLISH_BASE_URL` back at `https://2mrrw-live-relay.fly.dev`
with Fly's secret matching Vercel's again (`fly secrets set` on Fly).
