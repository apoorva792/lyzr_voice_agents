import { endSession } from '../../lib/lyzr.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // sendBeacon on page unload posts a Blob, which may not be pre-parsed.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const roomName = body?.roomName;
  if (!roomName) return res.status(400).json({ error: 'roomName is required' });

  const apiKey = process.env.LYZR_API_KEY;
  if (!apiKey) {
    console.error('LYZR_API_KEY is not set in this environment.');
    return res.status(500).json({ error: 'Server is missing LYZR_API_KEY.' });
  }

  try {
    const result = await endSession(apiKey, roomName);
    if (!result.ok) console.error(`Lyzr /sessions/end -> ${result.status}: ${result.body}`);
    else console.log(`session ended: ${roomName}`);
  } catch (err) {
    // Best effort: the browser has already torn down its side of the call.
    console.error('end failed:', err);
  }

  return res.status(200).json({ ok: true });
}
