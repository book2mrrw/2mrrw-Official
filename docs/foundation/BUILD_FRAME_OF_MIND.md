# 2MRRW — Platform Building Frame of Mind

This document is for Claude and all AI build sessions. Read this before every build session.

---

## What this platform is

2MRRW is not a music app. It is an artist's world — a single, sovereign space where one artist's entire creative output lives. Everything a fan needs from this artist exists here and only here. The music is not on Spotify. The experience is not on Apple Music. This is the destination.

This means every interaction carries weight. A fan who opens this platform has chosen to be here specifically. They are not browsing a catalog of millions. They are stepping into one artist's world. Every pixel, every animation, every tap response, every second of audio behavior either honors that or disrespects it.

There is no room for "good enough." The standard is: does this feel like it was built by people who deeply respected the person using it.

---

## The frame of mind for every build decision

**Mobile first. Always.**

The primary device is a phone. iOS Safari is the primary browser. Every feature gets designed for a phone screen, one hand, one thumb, in motion — on a subway, walking, lying in bed with the lights off. If it doesn't work perfectly there, it doesn't ship.

Desktop and tablet and car screen are real targets and they matter. But they are never the reason a mobile decision gets compromised. The experience scales up, never down.

**Cross-platform consistency is non-negotiable.**

Phone, tablet, desktop, car screen — the experience must feel like the same world. Same colors, same animations, same audio behavior, same interaction logic. A fan who uses this on their phone and then opens it on their laptop should feel at home immediately. Nothing should feel like a different product.

**Competing audio sources, lock screens, app switches, background tabs — all handled.**

This is a streaming platform. Audio is the core. Audio must behave like a first-class native app at all times:

- Lock the phone — audio keeps playing
- Switch to another app — audio keeps playing unless another audio source takes over
- Return to the app — audio is still there
- Dynamic Island stays active
- Lock screen controls work
- Bluetooth handoff works
- None of this requires the user to do anything extra

If any of these fail, the platform fails at its most fundamental job.

---

## The user

The person using this platform chose to be here. They found this artist, they care about this artist, and they came to this specific place to engage with the work. They are not casual. Treat them accordingly.

This means:

- Never make them tap twice when once is enough
- Never make them wait without feedback
- Never show them an error that looks like a broken website
- Never interrupt their audio unless they asked for it or another audio source took over
- Never show them pricing when they are entitled
- Never show them a broken layout because someone didn't test on their phone size

The experience should feel like the platform already knew what they wanted and made it effortless to get there.

---

## The aesthetic standard

This is an artist's world. It has to look and feel like one. Not a tech product, not a generic streaming UI, not a template. Every visual decision — colors, motion, typography, spacing — reflects the artist's identity.

What this means in practice:

- Colors pulled from the work itself (cover art palettes, visual language)
- Animations that feel intentional, not decorative — they communicate state, not just look nice
- Motion that respects the device — no jank, no dropped frames, nothing that feels heavy
- Typography that is readable at every size, on every screen, in every lighting condition
- Touch targets that never make the user miss — minimum 44x44px on every interactive element
- Safe areas respected on every device — nothing hidden behind a notch or home indicator
- Scroll that feels native — momentum, no rubber banding conflicts, no scroll-blocking modals

When in doubt: does this feel like Apple built it for an artist. That is the bar.

---

## What Claude must never do in this codebase

- Add UI that wasn't asked for
- Add state that wasn't asked for
- Add login flows to areas that are already behind authentication
- Add a second audio element
- Add dependency bumps without being asked
- Redesign the cinematic shell
- Make entitlement decisions on the client side
- Build the "safe" version of something when the right version was specified
- Pick between options the artist should be choosing
- Assume a desktop-first solution works for mobile
- Ship anything that requires the user to tap twice when the first tap should have been enough

---

## What Claude must always do

- Ask before adding anything that wasn't explicitly requested
- Ask when the audit gives options — never pick unilaterally
- Read the files before writing the code — every time, no exceptions
- Give exact file paths and line numbers in every audit finding
- Treat every build decision as if it will be used by millions of people on their phone
- Keep the existing architecture — build on what works, fix what doesn't, never rebuild what isn't broken
- Think about the human on the other side of the screen — what are they feeling, what do they need, what would make this feel effortless
- Respect that this platform is the artist's legacy — not a side project, not an MVP, not a prototype

---

## The checkpoints system

Every phase ends with a checkpoint:

- Verified git hash
- Files changed
- Fixes applied
- Build status confirmed

Recovery always targets only the broken component. Never full rebuilds.

Deploy flow: Supabase migrations first → dev to main merge → Vercel auto-builds.

---

## The standard in one sentence

Build this like you are competing with Spotify, Apple Music, and every major platform — but for one artist's world, where every single interaction is an opportunity to make a fan feel like they are exactly where they are supposed to be.
