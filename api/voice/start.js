import { startSession } from '../../lib/lyzr.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.LYZR_API_KEY;
  if (!apiKey) {
    console.error('LYZR_API_KEY is not set in this environment.');
    return res
      .status(500)
      .json({ error: 'Server is missing LYZR_API_KEY. Add it in the Vercel project settings.' });
  }

  try {
    const result = await startSession(apiKey);

    if (!result.ok) {
      console.error(`Lyzr /sessions/start -> ${result.status}: ${result.body}`);
      return res.status(result.status).setHeader('Content-Type', result.contentType).send(result.body);
    }

    console.log(`session started for ${result.userIdentity}`);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(result.body);
  } catch (err) {
    console.error('start failed:', err);
    return res.status(502).json({ error: `Could not reach Lyzr: ${err.message}` });
  }
}
