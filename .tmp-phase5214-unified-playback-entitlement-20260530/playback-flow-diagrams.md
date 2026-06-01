# Playback Flow Diagrams

**Phase 5.2.14** | Mermaid diagrams for unified entitlement playback

---

## 1. High-level unified engine

```mermaid
flowchart TB
  subgraph surfaces [Catalog Surfaces]
    LSR[LatestSinglesStyleRow]
    CG[CatalogGrid]
    ATS[AlbumTracklistSheet]
    RCP[ReleaseCardPlayButton]
    LIB[MyMusicTab / page.js modal]
  end

  subgraph normalize [Shared Normalization]
    MTP[toPlaybackTrack / albumTracksForPlayback]
    RTA[resolveTrackAccess]
    RPS[resolvePlaybackSrc]
  end

  subgraph engine [Single Playback Engine]
    PQ[playQueue / playTrack]
    PTI[playTrackInternal]
    AUDIO["single audio element"]
    QUEUE[queueRef / setQueue]
    MS[Media Session]
  end

  LSR --> MTP
  CG --> MTP
  ATS --> MTP
  RCP --> MTP
  LIB --> MTP

  MTP --> RTA --> RPS
  RPS --> PQ --> PTI --> AUDIO
  PQ --> QUEUE
  PTI --> MS
```

---

## 2. Asset resolution by entitlement

```mermaid
flowchart LR
  TAP[User tap] --> RTA{resolveTrackAccess}

  RTA -->|canStream false| PREV[catalogPreviewAudioUrl]
  RTA -->|canStream true| OFF{offline cache?}

  OFF -->|hit| BLOB[offline URL]
  OFF -->|miss| GATE{canRequestLibraryStream?}

  GATE -->|yes| STREAM["/api/library/stream redirect"]
  GATE -->|no| PREV

  PREV --> CDN{DIRECT_PREVIEW CDN?}
  CDN -->|flag ON + key| R2P[R2 public CDN]
  CDN -->|else| APIP["/api/media/preview redirect"]

  STREAM --> SRV[resolvePlaybackKey server]
  SRV --> MASTER[master R2 key]
  SRV -->|HYBRID flag| HYBRID[stream rendition key]

  PREV --> PTI[playTrackInternal]
  BLOB --> PTI
  R2P --> PTI
  APIP --> PTI
  MASTER --> PTI
  HYBRID --> PTI
```

---

## 3. Guest vs entitled playTrackInternal

```mermaid
sequenceDiagram
  participant UI as ReleaseCardPlayButton
  participant AC as AudioContext
  participant API as /api/library/stream
  participant CDN as Preview CDN/API

  Note over UI,CDN: Guest path
  UI->>AC: playQueue(track, preview src)
  AC->>AC: playTrackInternal
  AC->>CDN: load preview src
  AC->>AC: previewOnly cap 30s

  Note over UI,CDN: Entitled path
  UI->>AC: playQueue(track, stream redirect src)
  AC->>AC: playTrackInternal
  AC->>API: fetchLibraryStream background
  API-->>AC: signed proxy URL
  AC->>AC: swapToSignedStream
  AC->>AC: full duration, no cap
```

---

## 4. Queue lifecycle (all user types)

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Playing: playQueue / playTrack
  Playing --> Playing: playNext / playPrevious
  Playing --> Playing: autoAdvance on ended
  Playing --> Paused: pause / Media Session pause
  Paused --> Playing: resume / Media Session play
  Playing --> Idle: queue exhausted repeat off
  Playing --> Playing: repeat one / repeat all

  note right of Playing
    Same state machine for all tiers.
    Next track uses pre-resolved track.src
    from albumTracksForPlayback / toPlaybackTrack.
  end note
```

---

## 5. Prewarm (no entitlement fork)

```mermaid
flowchart TB
  VIS[Card enters viewport] --> HOOK[usePlaybackCardPrewarm]
  HOOK --> BUNDLE[buildReleasePrewarmBundle]
  BUNDLE --> RTA[resolveTrackAccess]
  BUNDLE --> DESC[buildPlaybackUrlDescriptor]
  DESC --> CACHE[playback-prewarm-cache Map]
  TAP[Play tap] --> GET[getPlaybackPrewarmEntry]
  GET --> TPT[toPlaybackTrack]
  TPT --> PQ[playQueue]

  note1[No audio bytes fetched]
  note2[Same access rules as play path]
  BUNDLE -.- note1
  RTA -.- note2
```

---

## 6. Hybrid streaming (future, flag-gated)

```mermaid
flowchart TB
  REQ[Entitled stream request] --> RPK[resolvePlaybackKey]
  RPK --> MASTER[Discover master in R2 folder]
  MASTER --> FLAG{isStreamPlaybackPreferred?}
  FLAG -->|OFF default| SIGN_M[Sign master key]
  FLAG -->|ON| TRY[tryResolveStreamPlaybackKey]
  TRY -->|hit| SIGN_S[Sign stream key]
  TRY -->|miss| SIGN_M

  GUEST[Guest] --> PREV[Preview resolver only]
  COLL_DL[Collector offline download] --> OFFLINE[getOfflinePlaybackUrl first in resolvePlaybackSrc]

  PREV -.->|never| RPK
  OFFLINE -.->|bypasses| RPK when cached
```
