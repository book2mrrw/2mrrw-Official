import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { persistNewUserProfileOrRollback } from "../provision-new-user.js";

function fakeAdmin({ profileError = null, rollbackError = null } = {}) {
  const calls = { rows: [], deletedUsers: [] };
  return {
    calls,
    from(table) {
      assert.equal(table, "profiles");
      return {
        async upsert(row, options) {
          calls.rows.push({ row, options });
          return { error: profileError };
        },
      };
    },
    auth: {
      admin: {
        async deleteUser(userId) {
          calls.deletedUsers.push(userId);
          return { error: rollbackError };
        },
      },
    },
  };
}

describe("new Auth user profile provisioning", () => {
  test("keeps the Auth principal only after its profile commits", async () => {
    const admin = fakeAdmin();
    const result = await persistNewUserProfileOrRollback(admin, {
      userId: "user-1",
      profile: { email: "person@example.com", role: "user" },
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(admin.calls.deletedUsers, []);
    assert.deepEqual(admin.calls.rows[0], {
      row: { id: "user-1", email: "person@example.com", role: "user" },
      options: { onConflict: "id" },
    });
  });

  test("removes the Auth principal when profile persistence fails", async () => {
    const admin = fakeAdmin({ profileError: new Error("profile unavailable") });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await persistNewUserProfileOrRollback(admin, {
        userId: "user-2",
        profile: { email: "person@example.com" },
      });
      assert.deepEqual(result, { ok: false, rollbackSucceeded: true });
      assert.deepEqual(admin.calls.deletedUsers, ["user-2"]);
    } finally {
      console.error = originalError;
    }
  });

  test("reports a failed compensation instead of claiming rollback succeeded", async () => {
    const admin = fakeAdmin({
      profileError: new Error("profile unavailable"),
      rollbackError: new Error("auth unavailable"),
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await persistNewUserProfileOrRollback(admin, {
        userId: "user-3",
        profile: { email: "person@example.com" },
      });
      assert.deepEqual(result, { ok: false, rollbackSucceeded: false });
      assert.deepEqual(admin.calls.deletedUsers, ["user-3"]);
    } finally {
      console.error = originalError;
    }
  });
});
