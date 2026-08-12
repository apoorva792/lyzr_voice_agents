import crypto from 'node:crypto';

/* Shared Lyzr calls, used by both the local Express server (server.js)
 * and the Vercel serverless functions in api/. */

export const LYZR_BASE = 'https://voice-livekit.studio.lyzr.ai';
export const AGENT_ID = '6a75aa6feb7f95ec320c21a0';

export const newUserIdentity = () =>
  `web_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

/** Returns the Lyzr body verbatim so the client sees the real field names. */
export async function startSession(apiKey) {
  const userIdentity = newUserIdentity();
  const upstream = await fetch(`${LYZR_BASE}/v1/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ agentId: AGENT_ID, userIdentity }),
  });
  return {
    userIdentity,
    ok: upstream.ok,
    status: upstream.status,
    contentType: upstream.headers.get('content-type') || 'application/json',
    body: await upstream.text(),
  };
}

export async function endSession(apiKey, roomName) {
  const upstream = await fetch(`${LYZR_BASE}/v1/sessions/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ roomName }),
  });
  return {
    ok: upstream.ok,
    status: upstream.status,
    body: upstream.ok ? '' : await upstream.text(),
  };
}
