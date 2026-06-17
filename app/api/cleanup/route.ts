import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cleanup — server-side cleanup of stale presence and old signals.
// Intended to be invoked by a cron job or internal operator. This endpoint
// performs destructive deletes and should be protected in production.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_request: NextRequest) {
  const now = Date.now();
    
  // Add small safety buffer to prevent race flicker
  const staleCutoff = new Date(now - (STALE_MS + 5000));
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  const presenceResult = await prisma.presence.deleteMany({
    where: { lastSeen: { lt: staleCutoff } },
  });

  const signalResult = await prisma.signal.deleteMany({
    where: { createdAt: { lt: signalCutoff } },
  });

  return Response.json({
    ok: true,
    removedPresence: presenceResult.count,
    removedSignals: signalResult.count,
  });
}
