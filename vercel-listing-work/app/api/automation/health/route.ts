import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const required = [
  'BLOB_READ_WRITE_TOKEN', 'AUTOMATION_ADMIN_SECRET', 'AUTOMATION_WORKER_SECRET',
  'EBAY_US_CLIENT_ID', 'EBAY_US_CLIENT_SECRET', 'EBAY_US_REFRESH_TOKEN',
  'EBAY_US_PAYMENT_POLICY_ID', 'EBAY_US_RETURN_POLICY_ID', 'EBAY_US_NORMAL_POLICY_ID', 'EBAY_US_FAST_POLICY_ID',
  'EBAY_AU_CLIENT_ID', 'EBAY_AU_CLIENT_SECRET', 'EBAY_AU_REFRESH_TOKEN',
  'EBAY_AU_PAYMENT_POLICY_ID', 'EBAY_AU_RETURN_POLICY_ID', 'EBAY_AU_NORMAL_POLICY_ID', 'EBAY_AU_FAST_POLICY_ID',
  'EBAY_AU_MERCHANT_LOCATION_KEY',
];

export async function GET() {
  const missing = required.filter((name) => !process.env[name]);
  return NextResponse.json({ ready: missing.length === 0, missing, notifications: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
}
