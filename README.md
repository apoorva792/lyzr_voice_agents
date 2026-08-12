# Lyzr Voice Agent Landing Page

A dark landing page with one button that starts a live, in-browser voice conversation with
a Lyzr voice agent over LiveKit / WebRTC.

- **Backend:** Node + Express (`server.js`), holds the Lyzr API key and proxies both Lyzr calls.
- **Frontend:** React + Vite (`client/`), talks to LiveKit with the `livekit-client` package.
- No database, no auth, no other services.

The API key stays on the server. The browser only ever receives the short-lived LiveKit
participant token that Lyzr mints for a single room.

## The Lyzr session API

`POST https://voice-livekit.studio.lyzr.ai/v1/sessions/start` returns a flat body. These are
the real field names, confirmed against the live API:

```json
{
  "userToken": "<LiveKit participant JWT>",
  "roomName": "room-<uuid>",
  "sessionId": "<uuid>",
  "livekitUrl": "wss://lyzr-4tysgnt4.livekit.cloud",
  "agentDispatched": true,
  "agentConfig": { "engine": { "kind": "realtime", "llm": "openai/gpt-realtime", "voice": "sage", "language": "en" }, "tools": ["search_knowledge_base"] }
}
```

| Purpose | Field |
| --- | --- |
| LiveKit server URL | `livekitUrl` |
| Participant access token | `userToken` |
| Room name (needed by `/end`) | `roomName` |

Nothing is nested under a `data` or `livekit` wrapper. The token grants `roomJoin`,
`canPublish`, `canSubscribe` and `canPublishData`, so the mic publishes and the data channel
is available for transcripts.

`POST /v1/sessions/end` with `{ "roomName": "..." }` returns **HTTP 204** and an empty body.

## Setup

```bash
# 1. install both packages
npm run setup

# 2. add your key
cp .env.example .env
#    then edit .env and set LYZR_API_KEY=<your key>
```

## Run in development

Two processes: Express on `3001`, Vite on `5173`. Vite proxies `/api` to Express, so there
are no CORS surprises.

```bash
npm run dev
```

Then open **http://localhost:5173** and click **Talk to an agent**.

To run the two halves separately instead:

```bash
npm run server   # Express on http://localhost:3001
npm run client   # Vite on http://localhost:5173
```

## Run as a single production server

Builds the React app and serves it from Express on one port.

```bash
npm start
```

Open **http://localhost:3001**.

## Notes

- **Microphone access needs a secure context.** `localhost` counts as secure, so local
  development works. If you deploy this anywhere else, serve it over https or the browser
  will refuse to hand over the mic.
- **The call must start from a click.** `startCall()` runs directly in the button's
  `onClick`, never from an effect, because browsers block mic capture and audio playback
  outside a real user gesture.
- **Transcript payloads.** The data-channel format is not documented, so `parseTranscript()`
  in [App.jsx](client/src/App.jsx) reads whatever arrives rather than assuming a schema: it
  handles plain text, JSON objects, arrays, and one level of nesting, and looks for the text
  under any of `text` / `transcript` / `message` / `content` / `delta` / `transcription` /
  `value`. The first five raw payloads of every call are logged to the browser console so
  you can confirm the real shape and tighten the parser if you want to.
  Both `RoomEvent.DataReceived` and `RoomEvent.TranscriptionReceived` are wired, since
  LiveKit agents may use either.
- **Sessions are cleaned up** on **End call**, and best effort on `beforeunload` / `pagehide`
  via `navigator.sendBeacon`, so closing the tab does not leave a room running.

## Files

| Path | What it is |
| --- | --- |
| [server.js](server.js) | Express: `POST /api/voice/start`, `POST /api/voice/end`, static hosting |
| [.env.example](.env.example) | Template for `LYZR_API_KEY` |
| [client/src/App.jsx](client/src/App.jsx) | The whole page and the LiveKit call logic |
| [client/src/styles.css](client/src/styles.css) | Lyzr Dark Landing tokens and layout |
| [client/vite.config.js](client/vite.config.js) | Dev server plus `/api` proxy to port 3001 |
