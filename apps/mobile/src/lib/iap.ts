import { initConnection, getProducts, requestPurchase, finishTransaction, type Product, type Purchase } from 'react-native-iap';
import { supabase } from './supabase';

const SUBSCRIPTION_PRODUCT_IDS = ['com.2mrrw.subscription.monthly', 'com.2mrrw.subscription.annual'];

export async function initIAP(): Promise<void> {
  await initConnection();
}

export async function getSubscriptionProducts(): Promise<Product[]> {
  return getProducts({ skus: SUBSCRIPTION_PRODUCT_IDS });
}

export async function purchaseSubscription(productId: string): Promise<Purchase> {
  return requestPurchase({ sku: productId });
}

export async function validateAndFinalizePurchase(purchase: Purchase): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/iap/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ receipt: purchase.transactionReceipt, productId: purchase.productId, platform: purchase.transactionId ? 'ios' : 'android' }),
  });

  if (!res.ok) return false;

  await finishTransaction({ purchase, isConsumable: false });
  return true;
}
