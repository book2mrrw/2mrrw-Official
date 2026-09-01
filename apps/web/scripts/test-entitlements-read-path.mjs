import assert from "node:assert/strict";

function mapLibrarySourceToEntitlementSource(source) {
  switch (String(source || "purchase")) {
    case "gift":
      return "gifted";
    case "grant":
      return "admin_grant";
    case "bundle":
      return "purchase";
    case "purchase":
    default:
      return "purchase";
  }
}

assert.equal(mapLibrarySourceToEntitlementSource("purchase"), "purchase");
assert.equal(mapLibrarySourceToEntitlementSource("gift"), "gifted");
assert.equal(mapLibrarySourceToEntitlementSource("grant"), "admin_grant");
assert.equal(mapLibrarySourceToEntitlementSource("bundle"), "purchase");

console.log("entitlements-read-path: ok");
