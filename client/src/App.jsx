import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, ConnectionState } from 'livekit-client';

/* ------------------------------------------------------------------ *
 * Field names below come from the real POST /v1/sessions/start body,
 * observed once before this was written:
 *   { userToken, roomName, sessionId, livekitUrl, agentDispatched,
 *     agentConfig: { engine: {...}, tools: [...] } }
 * All three values we need are flat, not nested under data/livekit.
 * ------------------------------------------------------------------ */
const LIVEKIT_URL_FIELD = 'livekitUrl';
const TOKEN_FIELD = 'userToken';
const ROOM_FIELD = 'roomName';

const STATUS_LABEL = {
  idle: 'Idle',
  connecting: 'Connecting',
  listening: 'Listening',
  speaking: 'Gia is speaking',
  ending: 'Ending call',
  ended: 'Call ended',
};

const browserSupported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof RTCPeerConnection !== 'undefined';

const isMicDenied = (err) =>
  ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(err?.name) ||
  /permission|denied|not allowed/i.test(err?.message || '');

/**
 * The data-channel payload shape is not documented, so this reads whatever
 * arrives rather than assuming a schema. Raw payloads are logged to the
 * console (see onData) so the shape can be confirmed against a live call.
 *
 * Returns an array of { id, speaker, text, final } or [] if there is no text.
 */
function parseTranscript(raw, fallbackSpeaker) {
  let data = raw;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        return [{ id: null, speaker: fallbackSpeaker, text: trimmed, final: true }];
      }
    } else {
      // Not JSON at all: treat the whole payload as a line of text.
      return [{ id: null, speaker: fallbackSpeaker, text: trimmed, final: true }];
    }
  }

  if (Array.isArray(data)) return data.flatMap((d) => parseTranscript(d, fallbackSpeaker));
  if (!data || typeof data !== 'object') return [];

  // Some agents wrap the real thing one level down.
  for (const key of ['segments', 'transcripts', 'messages', 'data', 'payload']) {
    const nested = data[key];
    if (Array.isArray(nested)) {
      return nested.flatMap((d) =>
        parseTranscript(d, pickSpeaker(data) || fallbackSpeaker)
      );
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const inner = parseTranscript(nested, pickSpeaker(data) || fallbackSpeaker);
      if (inner.length) return inner;
    }
  }

  const text = firstString(data, [
    'text',
    'transcript',
    'message',
    'content',
    'delta',
    'transcription',
    'value',
  ]);
  if (!text) return [];

  const final = [data.final, data.is_final, data.isFinal, data.done, data.completed].find(
    (v) => typeof v === 'boolean'
  );

  return [
    {
      id: data.id ?? data.segment_id ?? data.segmentId ?? data.messageId ?? null,
      speaker: pickSpeaker(data) || fallbackSpeaker,
      text,
      final: final ?? true,
    },
  ];
}

function pickSpeaker(obj) {
  const raw = firstString(obj, [
    'role',
    'speaker',
    'participant',
    'participantIdentity',
    'identity',
    'from',
    'sender',
    'source',
    'author',
  ]);
  if (!raw) return null;
  return /user|local|human|you/i.test(raw) ? 'you' : 'agent';
}

function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export default function App() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [supported] = useState(browserSupported);

  const roomRef = useRef(null);
  const roomNameRef = useRef(null);
  const audioHostRef = useRef(null);
  const scrollRef = useRef(null);
  const seenPayloads = useRef(0);

  const inCall = ['connecting', 'listening', 'speaking', 'ending'].includes(status);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const addLines = useCallback((lines) => {
    if (!lines.length) return;
    setTranscript((prev) => {
      const next = [...prev];
      for (const line of lines) {
        // Interim results stream in under a stable id: replace, do not append.
        const at = line.id ? next.findIndex((e) => e.id === line.id) : -1;
        if (at >= 0) next[at] = { ...next[at], ...line };
        else next.push({ ...line, key: `${Date.now()}-${next.length}` });
      }
      return next.slice(-200);
    });
  }, []);

  const startCall = useCallback(async () => {
    if (!supported) return;

    setError(null);
    setTranscript([]);
    setStatus('connecting');
    seenPayloads.current = 0;

    let room;
    try {
      const res = await fetch('/api/voice/start', { method: 'POST' });
      const body = await res.text();

      if (!res.ok) throw new Error(`Could not start the session (${res.status}): ${body}`);

      let session;
      try {
        session = JSON.parse(body);
      } catch {
        throw new Error(`Unexpected response from the server: ${body.slice(0, 200)}`);
      }

      const url = session[LIVEKIT_URL_FIELD];
      const token = session[TOKEN_FIELD];
      const roomName = session[ROOM_FIELD];

      if (!url || !token) {
        throw new Error(
          `Session response is missing ${LIVEKIT_URL_FIELD}/${TOKEN_FIELD}. Got: ${Object.keys(
            session
          ).join(', ')}`
        );
      }
      roomNameRef.current = roomName ?? null;

      room = new Room();
      roomRef.current = room;

      // Agent audio: attach every subscribed audio track so it plays.
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'audio') {
          const el = track.attach();
          el.autoplay = true;
          audioHostRef.current?.appendChild(el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));

      // Transcript over the data channel.
      const onData = (payload, participant, _kind, topic) => {
        let raw;
        try {
          raw = new TextDecoder().decode(payload);
        } catch {
          return;
        }
        if (seenPayloads.current < 5) {
          seenPayloads.current += 1;
          console.log('[data]', { topic, from: participant?.identity, raw });
        }
        const fallback = participant?.identity === room.localParticipant?.identity ? 'you' : 'agent';
        addLines(parseTranscript(raw, fallback));
      };
      room.on(RoomEvent.DataReceived, onData);

      // Newer livekit-client versions deliver agent transcripts on their own
      // event rather than the raw data channel, so listen to both.
      if (RoomEvent.TranscriptionReceived) {
        room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
          if (seenPayloads.current < 5) {
            seenPayloads.current += 1;
            console.log('[transcription]', { from: participant?.identity, segments });
          }
          const fallback =
            participant?.identity && participant.identity === room.localParticipant?.identity
              ? 'you'
              : 'agent';
          addLines(parseTranscript(segments, fallback));
        });
      }

      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connecting || state === ConnectionState.Reconnecting) {
          setStatus('connecting');
        } else if (state === ConnectionState.Connected) {
          setStatus((s) => (s === 'speaking' ? s : 'listening'));
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const agentTalking = speakers.some((p) => p.identity !== room.localParticipant?.identity);
        setStatus((s) => (inCallStatus(s) ? (agentTalking ? 'speaking' : 'listening') : s));
      });

      room.on(RoomEvent.Disconnected, () => setStatus((s) => (s === 'idle' ? s : 'ended')));

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus('listening');
    } catch (err) {
      console.error('startCall failed', err);
      try {
        await room?.disconnect();
      } catch {
        /* already down */
      }
      roomRef.current = null;
      setError(
        isMicDenied(err)
          ? 'We need mic access to start the call. Allow the microphone and try again.'
          : err.message || 'Something went wrong starting the call.'
      );
      setStatus('idle');
    }
  }, [addLines, supported]);

  const endCall = useCallback(async () => {
    const room = roomRef.current;
    const roomName = roomNameRef.current;
    roomRef.current = null;
    roomNameRef.current = null;

    setStatus('ending');
    try {
      await room?.disconnect();
    } catch (err) {
      console.error('disconnect failed', err);
    }
    audioHostRef.current?.replaceChildren();

    if (roomName) {
      try {
        await fetch('/api/voice/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName }),
        });
      } catch (err) {
        console.error('end request failed', err);
      }
    }
    setStatus('ended');
  }, []);

  // Best effort cleanup so a closed tab does not leave the session running.
  useEffect(() => {
    const onUnload = () => {
      const roomName = roomNameRef.current;
      if (!roomName) return;
      const blob = new Blob([JSON.stringify({ roomName })], { type: 'application/json' });
      navigator.sendBeacon?.('/api/voice/end', blob);
      roomRef.current?.disconnect();
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
    };
  }, []);

  return (
    <div className="page">
      <div className="blob" aria-hidden="true" />

      <header className="nav">
        <div className="shell nav-inner">
          <a className="wordmark" href="https://www.lyzr.ai" target="_blank" rel="noreferrer">
            {/* 441x170 source, so 73x28 keeps the ratio and reserves the space. */}
            <img src="/lyzr-logo.png" alt="Lyzr" width="73" height="28" />
          </a>
          <span className="nav-note">Voice agents</span>
        </div>
      </header>

      <main className="shell layout">
        <section className="hero">
          <p className="eyebrow">01 / Live voice</p>
          <h1>
            Talk to a <span className="grad">Lyzr agent</span>
          </h1>
          <p className="lead">
            Click below and you'll be talking to Gia, our AI, in a couple of seconds.
          </p>

          {!supported ? (
            <p className="unsupported">
              This browser cannot capture audio. Open the page in a recent Chrome, Edge, Safari or
              Firefox over https or localhost.
            </p>
          ) : (
            <>
              <div className="actions">
                {!inCall && status !== 'ending' && (
                  <button className="btn btn-primary" onClick={startCall}>
                    {status === 'ended' ? 'Talk again' : 'Talk to an agent'}
                  </button>
                )}
                {inCall && (
                  <button
                    className="btn btn-ghost"
                    onClick={endCall}
                    disabled={status === 'ending'}
                  >
                    End call
                  </button>
                )}
              </div>

              <p className="disclosure">AI agent &middot; you're speaking with an AI</p>
            </>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="panel" aria-label="Live transcript">
          <div className="panel-head">
            <span className="panel-title">Transcript</span>
            <span className={`status status-${status}`}>
              <span className="dot" aria-hidden="true" />
              {STATUS_LABEL[status]}
            </span>
          </div>

          <div className="panel-body" ref={scrollRef}>
            {transcript.length === 0 ? (
              <p className="empty">
                {inCall
                  ? 'Waiting for the first words.'
                  : 'The conversation will appear here once the call starts.'}
              </p>
            ) : (
              transcript.map((line, i) => (
                <p key={line.key ?? line.id ?? i} className={`line line-${line.speaker}`}>
                  <span className="who">{line.speaker === 'you' ? 'You' : 'Gia'}</span>
                  <span className="what">{line.text}</span>
                </p>
              ))
            )}
          </div>
        </section>
      </main>

      <div ref={audioHostRef} className="audio-host" aria-hidden="true" />
    </div>
  );
}

const inCallStatus = (s) => s === 'listening' || s === 'speaking';
