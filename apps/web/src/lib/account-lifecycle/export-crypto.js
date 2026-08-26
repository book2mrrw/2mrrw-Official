import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const MAGIC = Buffer.from("2MRRW-ACCOUNT-EXPORT-V1\n", "utf8");

function encryptionKey() {
  const encoded = process.env.ACCOUNT_EXPORT_KEK_BASE64;
  const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
  if (key.length !== 32) {
    throw Object.assign(new Error("ACCOUNT_EXPORT_KEK_BASE64 must decode to exactly 32 bytes"), {
      code: "export_kek_invalid",
    });
  }
  return key;
}

function encrypt(key, plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertext, tag: cipher.getAuthTag() };
}

export function encryptAccountExport({ requestId, plaintext }) {
  const keyVersion = process.env.ACCOUNT_EXPORT_KEK_VERSION?.trim();
  if (!keyVersion) throw Object.assign(new Error("ACCOUNT_EXPORT_KEK_VERSION is required"), { code: "export_kek_version_missing" });

  const dataKey = randomBytes(32);
  const payloadAad = `2mrrw:account-export:${requestId}:v1`;
  const wrappedKeyAad = `2mrrw:account-export-key:${requestId}:${keyVersion}`;
  const payload = encrypt(dataKey, plaintext, payloadAad);
  const wrapped = encrypt(encryptionKey(), dataKey, wrappedKeyAad);
  dataKey.fill(0);

  const envelope = Buffer.concat([MAGIC, payload.iv, payload.tag, payload.ciphertext]);
  return {
    envelope,
    contentSha256: createHash("sha256").update(plaintext).digest("hex"),
    ciphertextSha256: createHash("sha256").update(envelope).digest("hex"),
    keyVersion,
    wrappedDataKey: [wrapped.iv, wrapped.tag, wrapped.ciphertext]
      .map((part) => part.toString("base64url"))
      .join("."),
    format: "2mrrw-account-export-v1",
  };
}

function decrypt(key, iv, tag, ciphertext, aad) {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function decryptAccountExport({ requestId, envelope, wrappedDataKey, keyVersion }) {
  if (!Buffer.from(envelope).subarray(0, MAGIC.length).equals(MAGIC)) {
    throw Object.assign(new Error("Unknown account export format"), { code: "export_format_invalid" });
  }
  const parts = String(wrappedDataKey).split(".").map((part) => Buffer.from(part, "base64url"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) {
    throw Object.assign(new Error("Invalid wrapped export key"), { code: "export_wrapped_key_invalid" });
  }
  const dataKey = decrypt(encryptionKey(), parts[0], parts[1], parts[2],
    `2mrrw:account-export-key:${requestId}:${keyVersion}`);
  try {
    const bytes = Buffer.from(envelope);
    return decrypt(dataKey, bytes.subarray(MAGIC.length, MAGIC.length + 12),
      bytes.subarray(MAGIC.length + 12, MAGIC.length + 28), bytes.subarray(MAGIC.length + 28),
      `2mrrw:account-export:${requestId}:v1`);
  } finally {
    dataKey.fill(0);
  }
}
