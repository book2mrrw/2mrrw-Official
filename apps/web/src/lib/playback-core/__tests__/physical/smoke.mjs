import "./dom-shim.mjs";

const mods = [
  "@/lib/playback/audio-engine-runtime",
  "@/lib/playback/playback-commands",
  "@/lib/playback/command-executor",
  "@/lib/playback/command-dispatcher",
];

for (const m of mods) {
  try {
    await import(m);
    console.log("OK   ", m);
  } catch (e) {
    console.log("FAIL ", m, "\n      ", e.message.split("\n")[0]);
  }
}
