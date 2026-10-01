import { NextResponse } from "next/server";
import { getVapidPublicKey, isWebPushConfigured } from "@/lib/notifications";

export async function GET() {
  return NextResponse.json({
    publicKey: getVapidPublicKey(),
    configured: isWebPushConfigured(),
  });
}
