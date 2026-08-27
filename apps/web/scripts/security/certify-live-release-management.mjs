import crypto from "node:crypto";
import readline from "node:readline";

const APP_URL = "https://www.2mrrw.com";
const RUN_ID = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
const RELEASE_SLUG = `certification-${RUN_ID}`;
const DELETE_SLUG = `certification-delete-${RUN_ID}`;

function prompt(label, { secret = false } = {}) {
  if (!secret) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(label, (answer) => {
      rl.close();
      resolve(answer);
    }));
  }

  return new Promise((resolve) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    const onData = (buffer) => {
      const text = buffer.toString("utf8");
      if (text === "\u0003") process.exit(130);
      if (text === "\r" || text === "\n") {
        process.stdin.off("data", onData);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(value);
      } else if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
      } else if (!/[\u0000-\u001f]/.test(text)) {
        value += text;
      }
    };
    process.stdin.on("data", onData);
  });
}

function absorbSetCookies(jar, response) {
  const rawValues = response.headers.getSetCookie?.() || [];
  if (rawValues.length === 0) {
    const combined = response.headers.get("set-cookie");
    if (combined) rawValues.push(combined);
  }
  const values = rawValues.flatMap((value) =>
    value.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/));
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) jar.set(name, cookieValue);
    else jar.delete(name);
  }
}

const cookieHeader = (jar) => [...jar]
  .map(([name, value]) => `${name}=${value}`)
  .join("; ");

async function request(path, { method = "GET", jar, body } = {}) {
  const response = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      ...(jar?.size ? { Cookie: cookieHeader(jar) } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (jar) absorbSetCookies(jar, response);
  return response;
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function requireResponse(label, response, expected = [200]) {
  const payload = await json(response.clone());
  const passed = expected.includes(response.status);
  console.log(`${label}: ${passed ? "PASS" : "FAIL"} (${response.status})`);
  if (!passed) {
    const responseText = await response.text().catch(() => "");
    const safeError = typeof payload.error === "string"
      ? payload.error
      : responseText.replace(/\s+/g, " ").slice(0, 240) || "unexpected_response";
    throw new Error(`${label}: ${safeError}`);
  }
  return payload;
}

function makeWav({ frequency = 440, seconds = 1 } = {}) {
  const sampleRate = 8_000;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 3_000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
}

const COVER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function summarizeInventory(releases) {
  const normalizeType = (release) => {
    const raw = String(release.release_type || "").toLowerCase();
    if (["single", "singles", "song"].includes(raw)) return "single";
    if (["feature", "features"].includes(raw)) return "feature";
    if (["album", "albums"].includes(raw)) return "album";
    if (raw === "ep") return "ep";
    if (raw === "mixtape") return "mixtape";
    if (raw === "mixtapes-and-eps") return "mixtapes-and-eps";
    return raw;
  };
  const published = (type) => releases.filter(
    (release) => release.status === "published" && normalizeType(release) === type,
  ).length;
  return {
    Drafts: releases.filter((release) => release.status === "draft").length,
    Scheduled: releases.filter((release) => release.status === "scheduled").length,
    "Published Singles": published("single"),
    "Published Features": published("feature"),
    "Published Albums": published("album"),
    "Published EPs": published("ep"),
    "Published Mixtapes": published("mixtape"),
    "Published Mixtapes & EPs (legacy combined)": published("mixtapes-and-eps"),
  };
}

async function uploadAsset(jar, {
  releaseId,
  releaseType = "single",
  slug,
  assetType,
  filename,
  bytes,
  trackSlug,
  complete = true,
  completeFields = {},
}) {
  const presigned = await requireResponse(
    `PRESIGN ${assetType.toUpperCase()}`,
    await request("/api/admin/upload/presigned", {
      method: "POST",
      jar,
      body: {
        releaseType,
        slug,
        assetType,
        filename,
        size: bytes.length,
        ...(trackSlug ? { trackSlug } : {}),
      },
    }),
  );

  const put = await fetch(presigned.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": presigned.contentType },
    body: bytes,
  });
  console.log(`R2 PUT ${assetType.toUpperCase()}: ${put.ok ? "PASS" : "FAIL"} (${put.status})`);
  if (!put.ok) throw new Error(`R2 PUT ${assetType} failed`);

  if (!complete) return { key: presigned.key };
  const completed = await requireResponse(
    `COMPLETE ${assetType.toUpperCase()}`,
    await request("/api/admin/upload/complete", {
      method: "POST",
      jar,
      body: {
        releaseId,
        key: presigned.key,
        assetType,
        releaseType,
        slug,
        ...(trackSlug ? { trackSlug } : {}),
        ...completeFields,
      },
    }),
  );
  return { key: presigned.key, ...completed };
}

async function findStorefrontRelease(slug) {
  const response = await fetch(APP_URL, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`storefront request failed (${response.status})`);
  const html = await response.text();
  return html.includes(slug) || html.includes(encodeURIComponent(slug));
}

const email = String(await prompt("Admin email: ")).trim();
let password = await prompt("Admin password (hidden): ", { secret: true });
const jar = new Map();
let releaseId = null;
let releaseState = "none";
let passed = false;

try {
  await requireResponse(
    "LOGIN STEP 1",
    await request("/api/auth/login-step1", {
      method: "POST",
      jar,
      body: { email, password },
    }),
  );
  password = "";
  console.log("Enter the newly delivered code below.");
  const otp = String(await prompt("Six-digit OTP (hidden): ", { secret: true })).trim();
  await requireResponse(
    "LOGIN STEP 2 + MFA AUTHORITY",
    await request("/api/auth/login-step2", {
      method: "POST",
      jar,
      body: { code: otp },
    }),
  );

  const inventory = await requireResponse(
    "MANAGE RELEASES DATA",
    await request("/api/admin/releases", { jar }),
  );
  const releases = Array.isArray(inventory.releases) ? inventory.releases : [];
  if (releases.length === 0) throw new Error("Manage Releases returned no existing releases");
  console.log(`EXISTING RELEASES POPULATED: PASS (${releases.length})`);
  for (const [section, count] of Object.entries(summarizeInventory(releases))) {
    console.log(`  ${section}: ${count}`);
  }

  const genres = await requireResponse(
    "REPRESENTATIVE ADMIN READ",
    await request("/api/admin/genres", { jar }),
  );
  console.log(`GENRE TAXONOMY POPULATED: ${Array.isArray(genres.genres) && genres.genres.length > 0 ? "PASS" : "FAIL"} (${genres.genres?.length || 0})`);

  const deleteDraft = await requireResponse(
    "DRAFT CREATE FOR DELETE",
    await request("/api/admin/releases/draft", {
      method: "POST",
      jar,
      body: {
        release_type: "single",
        slug: DELETE_SLUG,
        upload_session_id: crypto.randomUUID(),
      },
    }),
  );
  await requireResponse(
    "DRAFT DELETE STAGING",
    await request(`/api/admin/releases/${deleteDraft.release_id}`, { method: "DELETE", jar }),
  );
  const afterDelete = await requireResponse(
    "DRAFT DELETE VISIBILITY",
    await request("/api/admin/releases", { jar }),
  );
  const deleteHidden = !(afterDelete.releases || []).some((release) => release.id === deleteDraft.release_id);
  console.log(`DRAFT REMOVED FROM MANAGE RELEASES: ${deleteHidden ? "PASS" : "FAIL"}`);
  if (!deleteHidden) throw new Error("staged draft remained visible");

  const created = await requireResponse(
    "RELEASE CREATE",
    await request("/api/admin/releases/draft", {
      method: "POST",
      jar,
      body: {
        release_type: "single",
        slug: RELEASE_SLUG,
        upload_session_id: crypto.randomUUID(),
      },
    }),
  );
  releaseId = created.release_id;
  releaseState = "draft";

  const title = `2MRRW Certification ${RUN_ID}`;
  const updatedTitle = `${title} Updated`;
  const draftPayload = {
    data: {
      title,
      release_type: "single",
      price: "2.99",
      genre: "R&B",
      release_date: new Date().toISOString().slice(0, 10),
    },
  };
  await requireResponse(
    "DRAFT SAVE",
    await request(`/api/admin/releases/${releaseId}/draft`, {
      method: "PUT",
      jar,
      body: { step_index: 2, draft_payload: draftPayload },
    }),
  );
  const resumed = await requireResponse(
    "DRAFT RESUME",
    await request(`/api/admin/releases/${releaseId}/draft`, { jar }),
  );
  const resumedTitle = resumed.snapshot?.draft_payload?.data?.title;
  console.log(`DRAFT SNAPSHOT ROUND TRIP: ${resumedTitle === title ? "PASS" : "FAIL"}`);
  if (resumedTitle !== title) throw new Error("draft snapshot did not round trip");

  const cover = await uploadAsset(jar, {
    releaseId,
    slug: RELEASE_SLUG,
    assetType: "cover",
    filename: "cover.png",
    bytes: COVER_PNG,
  });
  const audio = await uploadAsset(jar, {
    releaseId,
    slug: RELEASE_SLUG,
    assetType: "audio",
    filename: "master.wav",
    bytes: makeWav({ frequency: 440 }),
    completeFields: { trackTitle: title, position: 1 },
  });

  const published = await requireResponse(
    "RELEASE PUBLISH",
    await request(`/api/admin/releases/${releaseId}/publish`, {
      method: "POST",
      jar,
      body: {
        title,
        price: "2.99",
        genre: "R&B",
        content_rating: "clean",
        release_date: new Date().toISOString().slice(0, 10),
        cover_key: cover.key,
        audio_key: audio.key,
        track_id: audio.trackId,
      },
    }),
  );
  releaseState = "published";
  if (published.status !== "published") throw new Error("release did not enter published state");

  const publishedInventory = await requireResponse(
    "PUBLISHED RELEASE PLACEMENT",
    await request("/api/admin/releases", { jar }),
  );
  const publishedRow = (publishedInventory.releases || []).find((release) => release.id === releaseId);
  const publishedPlacement = publishedRow?.status === "published" && publishedRow?.release_type === "single";
  console.log(`PUBLISHED SINGLE SECTION: ${publishedPlacement ? "PASS" : "FAIL"}`);
  if (!publishedPlacement) throw new Error("published single placement failed");

  const inStorefront = await findStorefrontRelease(RELEASE_SLUG);
  console.log(`IMMEDIATE STOREFRONT PROPAGATION: ${inStorefront ? "PASS" : "FAIL"}`);
  if (!inStorefront) throw new Error("published release was not immediately visible in the storefront response");

  await requireResponse(
    "RELEASE METADATA UPDATE",
    await request(`/api/admin/releases/${releaseId}`, {
      method: "PATCH",
      jar,
      body: { title: updatedTitle, price: "3.49", genre: "Soul" },
    }),
  );
  const detail = await requireResponse(
    "RELEASE UPDATE READBACK",
    await request(`/api/admin/releases/${releaseId}`, { jar }),
  );
  const updatePersisted = detail.product?.title === updatedTitle && detail.product?.price_cents === 349;
  console.log(`RELEASE UPDATE PERSISTED: ${updatePersisted ? "PASS" : "FAIL"}`);
  if (!updatePersisted) throw new Error("release update did not persist");

  await uploadAsset(jar, {
    releaseId,
    slug: RELEASE_SLUG,
    assetType: "cover",
    filename: "cover.png",
    bytes: COVER_PNG,
  });
  console.log("REPLACE COVER: PASS");

  const replacementAudio = await uploadAsset(jar, {
    releaseId,
    slug: RELEASE_SLUG,
    assetType: "audio",
    filename: "replacement.wav",
    bytes: makeWav({ frequency: 660 }),
    trackSlug: "replacement",
    complete: false,
  });
  await requireResponse(
    "REPLACE MASTER",
    await request(`/api/admin/releases/${releaseId}/replace-master`, {
      method: "POST",
      jar,
      body: { key: replacementAudio.key, track_id: audio.trackId },
    }),
  );

  await requireResponse(
    "CATALOG REVALIDATION",
    await request("/api/admin/catalog/revalidate", { method: "POST", jar, body: {} }),
  );

  const future = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  await requireResponse(
    "SCHEDULE RELEASE",
    await request(`/api/admin/releases/${releaseId}`, {
      method: "PATCH",
      jar,
      body: { available_at: future, upcoming_visible: false },
    }),
  );
  releaseState = "scheduled";
  const scheduledInventory = await requireResponse(
    "SCHEDULED RELEASE PLACEMENT",
    await request("/api/admin/releases", { jar }),
  );
  const scheduledRow = (scheduledInventory.releases || []).find((release) => release.id === releaseId);
  console.log(`SCHEDULED SECTION: ${scheduledRow?.status === "scheduled" ? "PASS" : "FAIL"}`);
  if (scheduledRow?.status !== "scheduled") throw new Error("scheduled placement failed");

  await requireResponse(
    "RESTORE RELEASE TO LIVE",
    await request(`/api/admin/releases/${releaseId}`, {
      method: "PATCH",
      jar,
      body: { available_at: new Date(Date.now() - 1_000).toISOString() },
    }),
  );
  releaseState = "published";

  await requireResponse(
    "ARCHIVE CERTIFICATION RELEASE",
    await request(`/api/admin/releases/${releaseId}`, {
      method: "PATCH",
      jar,
      body: { action: "archive" },
    }),
  );
  releaseState = "archived";
  const archivedInventory = await requireResponse(
    "ARCHIVE READBACK",
    await request("/api/admin/releases", { jar }),
  );
  const archivedRow = (archivedInventory.releases || []).find((release) => release.id === releaseId);
  const archived = archivedRow?.status === "archived" && archivedRow?.storefront_visible === false;
  console.log(`ARCHIVED + HIDDEN: ${archived ? "PASS" : "FAIL"}`);
  if (!archived) throw new Error("archived release remained visible");

  const stillInStorefront = await findStorefrontRelease(RELEASE_SLUG);
  console.log(`STOREFRONT REVOCATION: ${!stillInStorefront ? "PASS" : "FAIL"}`);
  if (stillInStorefront) throw new Error("archived release remained in the storefront response");

  passed = true;
  console.log("RELEASE MANAGEMENT PRODUCTION CERTIFICATION: PASS");
} catch (error) {
  password = "";
  console.error(`RELEASE MANAGEMENT PRODUCTION CERTIFICATION: FAIL — ${error.message}`);
  process.exitCode = 1;
} finally {
  if (!passed && releaseId && jar.size > 0) {
    try {
      if (releaseState === "draft") {
        await request(`/api/admin/releases/${releaseId}`, { method: "DELETE", jar });
      } else if (releaseState === "published" || releaseState === "scheduled") {
        await request(`/api/admin/releases/${releaseId}`, {
          method: "PATCH",
          jar,
          body: { action: "archive" },
        });
      }
      console.log("FAILURE CLEANUP: ATTEMPTED");
    } catch {
      console.log("FAILURE CLEANUP: MANUAL REVIEW REQUIRED");
    }
  }
}
