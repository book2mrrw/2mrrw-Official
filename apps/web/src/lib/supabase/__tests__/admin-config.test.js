import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeServerEnvironmentValue } from "../admin.js";

describe("Supabase server environment configuration", () => {
  test("removes UTF-8 BOM and surrounding whitespace from injected values", () => {
    assert.equal(
      normalizeServerEnvironmentValue("\uFEFF  sb_secret_example\r\n"),
      "sb_secret_example",
    );
    assert.equal(
      normalizeServerEnvironmentValue("\r\n https://project.supabase.co \t"),
      "https://project.supabase.co",
    );
  });

  test("rejects non-string and empty configuration values", () => {
    assert.equal(normalizeServerEnvironmentValue(undefined), "");
    assert.equal(normalizeServerEnvironmentValue(null), "");
    assert.equal(normalizeServerEnvironmentValue("  \r\n"), "");
  });
});
