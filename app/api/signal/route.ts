import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { STALE_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { fromId, toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the `busy`
// flag so a user can only be in one connection at a time.
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { fromId, toId, type, payload } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof fromId !== "string" || typeof toId !== "string") {
    return Response.json({ error: "invalid ids" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  // Validate sender first.
  // Prevents stale clients from changing busy state.
  const sender = await prisma.presence.findUnique({
    where: {
      id: fromId,
    },
    select: {
      lastSeen: true,
    },
  });

  if (!sender) {
    return Response.json(
      {
        error: "sender offline",
      },
      {
        status: 409,
      },
    );
  }

  if (Date.now() - sender.lastSeen.getTime() > STALE_MS) {
    return Response.json(
      {
        error: "sender stale",
      },
      {
        status: 409,
      },
    );
  }

  // Requests require target availability.
  if (signalType === "request") {
    const allowed = await prisma.$transaction(async (tx) => {
      const target = await tx.presence.findUnique({
        where: { id: toId },
        select: { busy: true, lastSeen: true },
      });

      if (!target) {
        return false;
      }

      if (Date.now() - target.lastSeen.getTime() > STALE_MS) {
        return false;
      }

      if (target.busy) {
        return false;
      }

      const existingRequest = await tx.signal.findFirst({
        where: {
          toId,
          type: "request",
        },
      });

      if (existingRequest) {
        return false;
      }

      return true;
    });

    if (!allowed) {
      // Only send decline if requester is still alive.
      const initiator = await prisma.presence.findUnique({
        where: {
          id: fromId,
        },
        select: {
          lastSeen: true,
        },
      });

      if (initiator && Date.now() - initiator.lastSeen.getTime() <= STALE_MS) {
        await sendDecline(toId, fromId);
      }

      return Response.json({ ok: true, autoDecline: true });
    }
  }

  // Busy transitions:
  // - accept: the connection is now active → mark BOTH peers busy.
  // - decline/end: free both peers.
  if (signalType === "accept") {
    await prisma.presence.updateMany({
      where: {
        id: { in: [fromId, toId] },
      },
      data: {
        busy: true,
      },
    });
  } else if (signalType === "decline" || signalType === "end") {
    await prisma.presence.updateMany({
      where: {
        id: { in: [fromId, toId] },
      },
      data: {
        busy: false,
      },
    });
  }

  await prisma.signal.create({
    data: { fromId, toId, type: signalType, payload: payloadStr },
  });

  return Response.json({
    ok: true,
  });
  
  // Helper: deliver an auto-decline from `target` back to `initiator`.
  async function sendDecline(targetId: string, initiatorId: string) {
    await prisma.signal.create({
      data: {
        fromId: targetId,
        toId: initiatorId,
        type: "decline",
        payload: null,
      },
    });
  }
}
