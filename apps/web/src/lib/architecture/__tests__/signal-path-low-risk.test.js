import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("NAV-01/NAV-02 internal exits use soft navigation", () => {
  const home = read("src/app/HomeClient.js");
  const storefront = read("src/components/home/HomeStorefront.js");
  const subscribe = read("src/app/subscribe/page.js");

  assert.doesNotMatch(home, /window\.location\.assign\(COLLECTORS_CARDS_ROUTE\)/);
  assert.doesNotMatch(storefront, /window\.location\.href\s*=\s*COLLECTORS_CARDS_ROUTE/);
  assert.doesNotMatch(subscribe, /window\.location\.href\s*=\s*["']\/["']/);
  assert.match(home, /router\.push\(COLLECTORS_CARDS_ROUTE\)/);
  assert.match(storefront, /router\.push\(COLLECTORS_CARDS_ROUTE\)/);
  assert.match(subscribe, /router\.push\(["']\/["']\)/);
});

test("BOOT-03/BOOT-04 hydration and guest identity never cover the public shell", () => {
  const rootComponent = read("src/components/auth/AppAuthRoot.js");
  assert.doesNotMatch(rootComponent, /BOOT_PLACEHOLDER|showAuthGate|variant=["']root["']/);
  assert.match(rootComponent, /return children/);
});

test("BOOT-02/CAT-03 storefront tracks use one set-based query", () => {
  const catalog = read("src/lib/media/catalog-db.js");
  assert.match(catalog, /\.in\("product_id", productIds\)/);
  assert.match(catalog, /tracksByProductId\.get\(row\.id\)/);
  assert.doesNotMatch(catalog, /fetchTracksForProduct\(/);
});

test("SYS-05 admin preview object URLs have replacement and unmount revocation", () => {
  for (const relativePath of [
    "src/components/admin/UploadWizard.js",
    "src/components/admin/InlineReleasesManager.js",
  ]) {
    const source = read(relativePath);
    assert.match(source, /URL\.createObjectURL/);
    assert.match(source, /URL\.revokeObjectURL/);
    assert.match(source, /useEffect\(\(\) => \(\) =>/);
  }
});

test("BOOT-07/SYS-01 Stripe has one explicit, payment-scoped loader", () => {
  const layout = read("src/app/layout.js");
  const stripeClient = read("src/lib/commerce/stripe-client.js");
  assert.doesNotMatch(layout, /StripeProvider|@stripe\/stripe-js/);
  assert.match(stripeClient, /export function getStripeClient/);

  const sourceFiles = [
    "src/app/HomeClient.js",
    "src/app/subscribe/page.js",
    "src/components/payments/DonateModal.js",
    "src/components/collectors-cards/CollectorCardModal.js",
  ];
  for (const relativePath of sourceFiles) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /loadStripe|NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/);
    assert.match(source, /getStripeClient/);
  }
});
