import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { startSession, endSession } from './lib/lyzr.js';

/* Local development server. In production on Vercel these same two routes
 * are served by the serverless functions in api/voice/. */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.LYZR_API_KEY;

if (!API_KEY) {
  console.error('LYZR_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// POST /api/voice/start
// Passes the Lyzr body straight back to the browser, so the client sees the
// real field names (livekitUrl / userToken / roomName).
app.post('/api/voice/start', async (req, res) => {
  try {
    const result = await startSession(API_KEY);

    if (!result.ok) {
      console.error(`Lyzr /sessions/start -> ${result.status}: ${result.body}`);
      return res.status(result.status).type(result.contentType).send(result.body);
    }

    console.log(`session started for ${result.userIdentity}`);
    res.type('application/json').send(result.body);
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
    const result = await endSession(API_KEY, roomName);
    if (!result.ok) console.error(`Lyzr /sessions/end -> ${result.status}: ${result.body}`);
    else console.log(`session ended: ${roomName}`);
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
