# Commands and Transitions

Implemented command constants:
- PLAY_TRACK
- PLAY_QUEUE
- PAUSE
- RESUME
- SEEK
- NEXT_TRACK
- PREV_TRACK
- INTERRUPT
- RECOVER
- STOP
- COMPLETE

Transition map (`executePlaybackCommand`):
- PLAY_TRACK -> `playTrackInternal(track, options)`
- PLAY_QUEUE -> `playQueueInternal(tracks, startIndex, options)`
- PAUSE/INTERRUPT -> `pauseInternal()`
- RESUME/RECOVER -> `resumeInternal()`
- SEEK -> `seekInternal(time)`
- NEXT_TRACK/COMPLETE -> `playNextInternal()`
- PREV_TRACK -> `playPreviousInternal()`
- STOP -> `stopInternal()`

Execution characteristics:
- Commands are serialized by default through an internal promise queue.
- Selected commands support non-serialized execution for responsiveness (`SEEK`).
- Request IDs are stamped per command and stale command completions are ignored.
