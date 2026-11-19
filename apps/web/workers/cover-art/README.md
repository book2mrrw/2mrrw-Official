# Cover art lane

Silent, phone-sized looping versions of every animated cover. Its own lane in
the 2MRRW-Cloud model: its own image, queue, storage prefix and delivery — it
shares nothing with the audio, video, vault or track-visual lanes.

| Piece | Where |
|---|---|
| Worker (this folder) | `src/worker.js` claims, `src/transcode.js` encodes, `src/lane-api.js` reads originals / writes renditions through the website's signed links, `src/queue.js` talks to the queue |
| Queue | table `cover_art_versions`, functions `queue_cover_art`, `claim_cover_art_job`, `heartbeat_cover_art_job`, `complete_cover_art_job` (`supabase/migrations/20261118190000_cover_art_lane.sql`) |
| Database login | role `cover_art_worker`: may only claim, heartbeat and finish jobs (no table access, no queueing) |
| Renditions | R2 media bucket, `cover-art/<type>/<slug>/<version>/<id>.mp4`, immutable |
| Delivery | `src/lib/cover-art/delivery.js`, used by `/api/media/visual` |
| Storage links | `src/lib/cover-art/transfers.js`, `POST /api/cover-art/transfers` (the website holds the bucket key) |

## What it makes

For each cover video version (R2 key + ETag): `square-1080`, `square-720`,
`square-480` (never upscaled) and `tall` (centre 3:4, at most 810x1080, the
iPhone lock screen's animated artwork). Every file is H.264, no audio track,
at most 30 fps, index first. Originals are never modified.

`/api/media/visual` redirects a cover video to its largest square once a
version is ready (`?variant=720|480|tall` picks another), and to the original
until then. The same route queues covers: a cover video seen with no version,
or whose original's ETag changed, is queued after the response. Nothing else
has to list or register covers.

## Credentials

`cover-art.env` (template: `cover-art.env.example`) holds one credential and
the website's address. The lane has **no storage key**: for the job it holds,
`POST /api/cover-art/transfers` with the job id and lease token returns a
15-minute link to read that job's original and links to write its renditions
under `cover-art/` — nothing else, and only while the lease is current.


- `COVER_ART_DATABASE_URL` — the `cover_art_worker` login through the Supabase
  session pooler. TLS is verified against `certs/supabase-root-2021.crt`
  (Supabase Root 2021 CA, expires 2031-04-26). The migration creates the role
  without a password; set one as a SCRAM verifier so the plain password never
  leaves the host that keeps the env file:

  ```sh
  python3 - <<'PY' > verifier.txt   # prints the verifier; put the password itself in cover-art.env
  import base64, hashlib, hmac, os, getpass
  pw = getpass.getpass().encode(); salt = os.urandom(16); i = 4096
  salted = hashlib.pbkdf2_hmac("sha256", pw, salt, i)
  client = hmac.new(salted, b"Client Key", "sha256").digest()
  stored = hashlib.sha256(client).digest(); server = hmac.new(salted, b"Server Key", "sha256").digest()
  b = lambda x: base64.b64encode(x).decode()
  print(f"SCRAM-SHA-256${i}:{b(salt)}${b(stored)}:{b(server)}")
  PY
  # then, as the database owner: alter role cover_art_worker with login password '<verifier>';
  ```

- `COVER_ART_API_URL` — the website (default `https://www.2mrrw.com`).

## Running it

Any host with Docker Compose. Put the environment file next to `compose.yaml`
(`cp cover-art.env.example cover-art.env`, fill it, `chmod 600 cover-art.env`),
or point `COVER_ART_ENV_FILE` at it.

```sh
docker compose build                                         # the image
docker compose run --rm cover-art node src/worker.js --once  # drain the queue, then exit
docker compose up -d                                         # keep running (restarts on failure/boot)
docker compose logs -f cover-art                             # one JSON line per event
docker compose down                                          # stop (a job in flight is retried)
```

Tests run against the image's own FFmpeg:
`docker run --rm -v "$PWD/src:/app/src:ro" --entrypoint node 2mrrw/cover-art:local --test src/__tests__/transcode.test.js`.
On a developer machine: `npm test` with `FFMPEG`/`FFPROBE` pointing at local binaries.
The queue's database contract: `npm run test:cover-art-db` in `apps/web`;
the website's delivery: `npm run test:cover-art`.

## Moving to another host

The lane keeps no state on its host: the queue is in the database, the
renditions in R2, scratch is memory-backed. To move it (for example from the
Mac's Lima VM to the owned primary server):

1. On the new host: this folder at the same commit (`git clone` + `git checkout <commit>`,
   or copy the folder), and `cover-art.env` copied over a secure channel (`scp`, then `chmod 600`).
2. Same image bits: `docker save 2mrrw/cover-art:<tag> | ssh <new-host> docker load`;
   or rebuild there with `docker compose build` (same Dockerfile; Debian may ship a newer
   FFmpeg patch release — the image records its version in `/etc/cover-art-ffmpeg-version`).
3. `docker compose up -d` on the new host, then `docker compose down` on the old one.

Two workers at once are safe (claims are exclusive and leased), so there is no
downtime window to plan. A worker stopped mid-encode leaves its job leased; the
lease expires after five minutes and the job is retried (three attempts).

## Checking and rolling back

```sql
select status, count(*) from cover_art_versions group by status;
select source_key, error_message from cover_art_versions where status = 'failed';
```

Stopping the lane never breaks a cover: unprocessed covers keep their
originals. To stop serving a cover's renditions, mark its versions
`superseded`; the route falls back to the original within two minutes.
