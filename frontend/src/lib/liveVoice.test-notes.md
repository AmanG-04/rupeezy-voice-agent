# Live browser behavior

PCM capture uses an AudioWorklet and emits 100 ms frames of 16 kHz signed little-endian mono audio. Gemini output is decoded as 24 kHz PCM and scheduled gaplessly in the AudioContext. Server interruption events stop queued playback. Browser echo cancellation is requested, but headphones are recommended.

The stop-playback button only stops local buffered audio. Speaking triggers model-side VAD/barge-in. Session end stops microphone tracks and the worklet, flushes backend transcripts, releases the session lock, and then runs post-call analysis.

Manual acceptance: allow microphone, ask a price question, switch to Hinglish, interrupt while audio is playing, mute/unmute, end and inspect the handoff. Repeat with both models and with navigation away during a reply. These checks require an actual microphone and speakers; headless layout checks do not establish voice quality.
