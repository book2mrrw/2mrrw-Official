import { createAdminClient } from "@/lib/supabase/admin";

const STRIPE_CUSTOMERS_TABLE = "stripe_customers";

function isMissingTableError(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function contactFields(user) {
  return {
    email: user?.email || undefined,
    phone: user?.phone || undefined,
    name: user?.name || undefined,
  };
}

function customerMetadata(user) {
  return {
    platform_user_id: user.id,
    user_id: user.id,
    guest_user_id: user.id,
  };
}

async function readMappedCustomerId(admin, userId) {
  const { data, error } = await admin
    .from(STRIPE_CUSTOMERS_TABLE)
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (isMissingTableError(error)) return null;
  if (error) throw error;
  return data?.stripe_customer_id || null;
}

async function readMembershipCustomerId(admin, userId) {
  const { data, error } = await admin
    .from("memberships")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .not("stripe_customer_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.stripe_customer_id || null;
}

async function retrieveActiveCustomer(stripe, customerId) {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer?.deleted ? null : customer;
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === "resource_missing") {
      return null;
    }
    throw error;
  }
}

export async function rememberStripeCustomer({ admin = createAdminClient(), userId, stripeCustomerId, email, phone }) {
  if (!userId || !stripeCustomerId) return;

  const { error } = await admin
    .from(STRIPE_CUSTOMERS_TABLE)
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: stripeCustomerId,
        email: email || null,
        phone: phone || null,
      },
      { onConflict: "user_id" }
    );

  if (isMissingTableError(error)) {
    console.warn("[stripe-customers] stripe_customers table missing; customer mapping was not persisted");
    return;
  }
  if (error) throw error;
}

export async function getOrCreateStripeCustomerForUser(stripe, user) {
  if (!user?.id) return null;

  const admin = createAdminClient();
  const mappedCustomerId = await readMappedCustomerId(admin, user.id);
  const membershipCustomerId = mappedCustomerId || await readMembershipCustomerId(admin, user.id);
  const existingCustomer = await retrieveActiveCustomer(stripe, membershipCustomerId);

  if (existingCustomer) {
    await rememberStripeCustomer({
      admin,
      userId: user.id,
      stripeCustomerId: existingCustomer.id,
      email: user.email,
      phone: user.phone,
    });
    return existingCustomer;
  }

  const customer = await stripe.customers.create(
    { metadata: customerMetadata(user) },
    { idempotencyKey: `platform-customer-${user.id}` }
  );

  await stripe.customers.update(customer.id, contactFields(user));
  await rememberStripeCustomer({
    admin,
    userId: user.id,
    stripeCustomerId: customer.id,
    email: user.email,
    phone: user.phone,
  });

  return customer;
}
