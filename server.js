import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LYZR_BASE = 'https://voice-livekit.studio.lyzr.ai';
const AGENT_ID = '6a75aa6feb7f95ec320c21a0';
const API_KEY = process.env.LYZR_API_KEY;
const PORT = process.env.PORT || 3001;

if (!API_KEY) {
  console.error('LYZR_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// POST /api/voice/start
// Mints a Lyzr voice session and passes the Lyzr body straight back to the browser,
// so the client sees the real field names (livekitUrl / userToken / roomName).
app.post('/api/voice/start', async (req, res) => {
  const userIdentity = `web_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  try {
    const upstream = await fetch(`${LYZR_BASE}/v1/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ agentId: AGENT_ID, userIdentity }),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      console.error(`Lyzr /sessions/start -> ${upstream.status}: ${text}`);
      return res
        .status(upstream.status)
        .type(upstream.headers.get('content-type') || 'text/plain')
        .send(text);
    }

    console.log(`session started for ${userIdentity}`);
    res.type('application/json').send(text);
  } catch (err) {
    console.error('start failed:', err);
    res.status(502).json({ error: `Could not reach Lyzr: ${err.message}` });
  }
});

// POST /api/voice/end  { roomName }
app.post('/api/voice/end', async (req, res) => {
  const { roomName } = req.body || {};
  if (!roomName) return res.status(400).json({ error: 'roomName is required' });

  try {
    const upstream = await fetch(`${LYZR_BASE}/v1/sessions/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ roomName }),
    });

    if (!upstream.ok) {
      console.error(`Lyzr /sessions/end -> ${upstream.status}: ${await upstream.text()}`);
    } else {
      console.log(`session ended: ${roomName}`);
    }
  } catch (err) {
    // Best effort: the browser has already torn down its side of the call.
    console.error('end failed:', err);
  }

  res.json({ ok: true });
});

// Serve the built React app.
const dist = path.join(__dirname, 'client', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built yet. Run: npm run build');
  });
});

app.listen(PORT, () => {
  console.log(`Lyzr voice backend on http://localhost:${PORT}`);
});
