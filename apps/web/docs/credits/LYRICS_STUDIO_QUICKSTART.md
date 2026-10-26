# Start adding lyrics in GLYPHS Studio

Use the studio inside Upload Manager for both new releases and songs already on 2MRRW.

- **New release:** upload its audio, then open **Artwork & Lyrics**. For an album, open the lyrics for the recording you want to time.
- **Current song:** open the release in Upload Manager, then choose **Lyrics**.

## 1. Write

Paste your lyrics into **Write**. Put one sung line on each row and leave a blank row between sections. Write repeated choruses out in full. Your text stays editable; timing is optional.

Use **Import LRC** for existing text or timing files. **Export LRC** downloads the current lyric document after timings are applied.

## Save unfinished work

Use **Save draft** at any point, including when lyrics are incomplete or only some lines/words have timestamps. You do not need to apply timing or publish to save a draft.

- **Current releases:** the working copy is private to your editing account and recording. Changes have an immediate device recovery copy and sync to the server after a pause. **Draft saved** confirms server acknowledgement. **Saved on this device** means refresh recovery is available in this browser while server sync is pending or unavailable.
- **Uploads:** Save draft uses the upload wizard’s existing server autosave and resume path, including unfinished lyric timing.
- Reopen the same song to resume its saved words and exact partial timing. Publishing/listener lyrics stay separate until you use the normal final save.
- If another saved version exists, **Use saved draft** restores it; **Keep this draft** keeps your current working copy. A changed published baseline requires reopening the release before saving over it.

The private-draft migration and its production verification are documented in the [rollout record](../../../../docs/reports/phase-lyrics-whole-line/ROLLOUT.md). Device recovery remains explicitly labelled whenever server saving is unavailable; only an acknowledged server save displays **Draft saved**.

## 2. Time

Your selected recording prepares automatically when you enter lyrics. This uses the audio already uploaded earlier in the release workflow. The recording transport is available in Write, Time and Preview; wait for **Recording ready**, then press Play. There is no separate Load step. If preparation fails, use **Retry recording**. Capture becomes available when this recording’s actual audio metadata is ready.

Press the large play button, or press **P** while the studio has focus. Slow playback to 0.75× or 0.5× if that helps.

**Line timing:** tap the large capture pad, or press **Space**, when the first word of the selected line is sung. The next line becomes selected automatically. The cue list shows your place and the timeline marks the cues you've captured.

**Word timing:** choose **Word timing**. Hold the capture pad, or hold **Space**, for the selected word's sung duration. Release when the word ends. The next word becomes selected automatically. Tap a word chip to revisit it.

Gestures and shortcuts stay inside this studio:

- Swipe **left/right on the capture pad** to choose the previous/next line or word. A swipe does not create a timestamp.
- Press **↑/↓** to choose the previous/next lyric unit.
- Press **←/→** to scrub backward/forward three seconds, or use the position slider.
- Press **Shift + ←/→** to move the selected cue earlier/later by 50 milliseconds.
- Press **⌘/Ctrl + Z** to undo; add **Shift** to redo. Typing fields retain their normal editing shortcuts.
- Press **Esc** to pause and cancel a held capture. Losing focus, scrolling the pad vertically, or canceling a touch does not commit a held word.

Open **Fine-tune selected line/word** for exact timestamps, ±50 ms buttons, a whole-song offset, or clearing timing. Moving a line with existing word cues shifts its words together.

Use **Rehearse line** to hear a timed line with two seconds of lead-in. Enable **Loop line** to repeat that section until it feels right. A loop or seek cancels a held word so it cannot span a playback jump.

Starting reference playback pauses the main player through its normal controls and pauses any other studio reference. Opening the studio alone does not interrupt listening. Returning to Write pauses the reference; moving between Time and Preview keeps it playing. The same prepared recording stays mounted across all three views, so returning to Time does not require loading it again.

## 3. Preview and apply

Choose **Preview** to see the lyrics over your release artwork. The preview uses the same whole-line illumination as the listener. Word timestamps remain optional editing detail; they never force individual-word illumination. A phrase stays lit until the next line’s actual start, including held notes and pauses. The final phrase stays lit to the known recording end. Stanza gaps add spacing without guessed silence durations.

The checklist identifies missing or invalid cues. Choose a line in the issue list to return to it. If the recording changed, review the timing against the new recording and confirm that review.

Choose **Apply timings** when you are ready. Then finish the appropriate save:

- **Current song:** choose **Save Lyrics** below the studio.
- **New release:** continue to **Review**, then publish or schedule the release.

Applied means the timing is ready for the release save; it does not mean the release has already been saved or published. Upload drafts retain unfinished timing for later resume. Publication requires timing to be applied or removed.

Use **Keep text only** to remove timing and retain your words. Clearing all lyrics in Write also clears their timing, and Undo can restore the previous edit.

Use **Discard lyric edits** to restore the last saved current-song lyrics, or the upload lyrics from when that recording’s studio was opened. Confirm with **Discard changes**; Undo can restore the discarded edit. Current-release Back and page-unload protection warn when the current edit has neither a successful device copy nor a server acknowledgement. Upload drafts continue to use the existing autosave and resume workflow.

If audio cannot load, confirm the upload finished, retry the recording, and try the native audio controls. Browser support for the original audio format still applies. The studio does not automatically transcribe or guess timestamps.

Implementation and pre-release evidence: [Phase report](../../../../docs/reports/phase-lyrics-whole-line/PHASE_REPORT.md). That report preserves the local verification snapshot before the authorized rollout.
