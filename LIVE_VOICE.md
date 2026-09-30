# Native-audio voice demo

The product is branded Voice Studio. New browser sessions default to a fictional course-enquiry agent; Rupeezy is an optional example in configuration. Save and try voice opens `/voice`. Starting a Live conversation now requests a spoken greeting, so a custom agent speaks first instead of waiting silently. Text chat remains a secondary test option.

`/voice` now runs Gemini Live. `/voice/classic` retains browser STT + text generation + Edge TTS.

## Local use

Run the backend on port 8000 and Vite on port 5173. Vite proxies both HTTP and WebSocket requests. Open http://localhost:5173/voice in Chrome or Edge, allow the microphone, and speak. Use headphones for best echo behavior.

The model selector offers:

- gemini-3.8-live (default)
- gemini-3.1-flash-live-preview (comparison)

Both were verified with the existing no-billing AI Studio key. Changing the text-chat model environment variable does not change the Live selector. The API key remains on the backend.

## Data flow

Browser microphone → AudioWorklet → 16 kHz PCM frames → backend WebSocket → Gemini Live → 24 kHz PCM → browser AudioContext.

Input/output transcriptions populate the UI and persisted conversation. `lookup_knowledge` retrieves the existing Rupeezy knowledge chunks or returns the custom session's confirmed knowledge. Ending the session stops microphone capture, flushes transcripts, and releases the Live lock before the existing classifier builds the handoff. There is no real telephony, messaging, or callback scheduling.

Speak over the response to trigger model-side interruption. Stop playback clears local queued audio only. Mute prevents sending microphone frames. Typed prompts also work once connected, but microphone permission is currently needed to start the voice session.

## Free-tier controls

Sessions have a five-minute maximum and the single backend worker accepts up to three concurrent Live sessions. These are resource controls, not a token billing cap. Keep API billing disabled for zero paid usage. Render's free service can take approximately 60 seconds to wake up. Vercel connects to the existing Render HTTPS URL using WSS; no additional service is required. Existing CORS origins must include the frontend URL because the WebSocket route also validates Origin.

## Verification

Approved live tests verified audio output, transcription, retrieval function calls, and answers incorporating tool results on both models. An end-to-end FastAPI WebSocket check verified that audio/transcripts arrive and the conversation persists as voice. Offline tests cover config, typed-turn persistence, and rejection of unsupported model IDs. Headless browser checks verify desktop/mobile layout and the model selector; actual microphone recognition and audible interruption quality require a manual test.

No subjective voice-quality or microphone-to-audio latency result is claimed. The earlier model comparison used text prompts to audio and is not a complete microphone benchmark.
