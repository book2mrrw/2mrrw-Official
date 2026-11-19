# HLS transcoder lanes

One image, one entry point per lane:

| Lane | Entry point | Queue | Content |
|---|---|---|---|
| audio | `src/workers/audio-worker.js` | `hls_transcode_jobs` (audio) | songs |
| video | `src/workers/video-worker.js` | `hls_transcode_jobs` (video) | music videos, short films, documentaries (Audio Visualz) |
| vault-video | `src/workers/vault-video-worker.js` | `hls_transcode_jobs` (vault) | vault videos |
| track-visual | `src/workers/track-visual-worker.js` | `track_visual_jobs` | per-track looping visuals |

Animated cover art is not here: it has its own lane (`../cover-art`).

## The image

`Dockerfile` builds for amd64 and arm64 from sources that cannot rotate or
disappear:

- FFmpeg 9.0.2 from the official release tarball, SHA-256 pinned (signature
  verified against the FFmpeg release key when pinned);
- libvmaf 3.0.0 (VMAF + cambi + float_ssim for the quality evaluator) from
  Netflix's tagged source, SHA-256 pinned, linked statically — Debian does not
  package it;
- libplacebo 7.360.1 (Vulkan HDR -> SDR tone-mapping for music videos and
  track visuals; FFmpeg 9.0 needs >= 7.351 and Debian 13 ships 7.349): the
  upstream release as Debian archived it on `snapshot.debian.org`, checked
  against the SHA-256 in Debian's signed `.dsc`; the one shared library the
  image adds to `/usr/local/lib`;
- every other library from Debian 13 at one `snapshot.debian.org` moment
  (`DEBIAN_SNAPSHOT`, kept forever), so a rebuild years later resolves the same
  versions; the runtime installs exactly the packages FFmpeg links against;
- Node dependencies from `package-lock.json` (`npm ci`).

The hosts have no GPU: libplacebo runs on Mesa's software Vulkan (lavapipe),
which the image installs.

To move to newer FFmpeg or libraries, change those pins together and rebuild.

## Running the video lanes on an owned host (2MRRW-Cloud)

```sh
cp hls-lanes.env.example hls-lanes.env && chmod 600 hls-lanes.env   # one secret
docker compose -f compose.video.yaml build
docker compose -f compose.video.yaml up -d                 # or: up -d video
docker compose -f compose.video.yaml logs -f video
```

`compose.video.yaml` mirrors Fly's process groups: the same entry points,
scratch volumes and sizes (4 CPUs / 8 GB each). Scratch is disposable;
masters and published media stay in R2.

**Keyless.** A host holds one secret: the password of `hls_media_worker`, the
lanes' own database login (migration `20261119150000_hls_media_worker_role.sql`),
which can call the lane functions and touches no table (`src/lane-db.js`, TLS
verified against `certs/`). Everything else is per job, from the website
(`POST /api/hls/lane-transfers`, `src/lane-transfers.js`), for the lease the
job holds: a read link for its source, write links under that attempt's own
folder, that job's content key (the key viewers' players already get) and, for
a music video, its folder details. No service-role key, no R2 key, no
`HLS_MASTER_SECRET` ever reaches a host, so moving to another host is copying
`hls-lanes.env`.

## Leases: the audio, video and vault lanes (`src/media-lane.js`)

All three claim through `hls_claim_media_job` (migrations
`20261119120000_hls_media_lane_leases.sql`, `20261119170000_hls_audio_media_lease.sql`),
never the legacy `hls_claim_next_job` (still used by Fly's old audio worker
until it is stopped; the two split the queue and never take each other's
jobs):

- every claim gets a fresh lease token and counts as an attempt (three in all);
- the lease is renewed every 30 s; a job nobody renewed for five minutes is
  retried by the next claim from any host, under a new generation, or failed
  after its third attempt — the lane recovers itself, with no website cron;
- every write names the lease and is refused once the job has moved on, so a
  worker that lost its job can never publish over the one that took it; a
  music video publishes renditions, ready, promotion and completion in one
  transaction (`hls_commit_video_job`); songs and vault videos through
  `hls_commit_transcode_job` (a song at audio profile 3, `src/transcoder.js`);
- each attempt uploads under its own generation folder and works in its own
  scratch directory (named by its lease); a host's boot removes the scratch
  of every lease no longer held. An abandoned attempt's partial uploads stay
  in their own unreferenced folder;
- a lost lease stops the worker (exit 75, restarted by Compose); validation,
  missing-input and probe failures fail at once instead of retrying.

**Cutover from Fly, per lane.** Stop the Fly process group first
(`fly scale count 0 --process-group video -a 2mrrw-hls-transcoder`; vault:
`-a 2mrrw-vault-video`), then start the same lane here. Queued jobs wait in
the database meanwhile. `docker compose stop` hands a running job straight
back (its attempt not spent), so moving a lane between owned hosts is stop
here, start there.
