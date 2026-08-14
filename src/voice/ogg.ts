/**
 * Ogg/Opus container inspection.
 *
 * Pure functions, zero dependencies — no I/O, no env, no clients. Used to fill
 * the duration field of a voice-note bubble and as a regression check that TTS
 * output stayed mono (some mobile clients refuse stereo voice notes).
 */

export interface OggOpusInfo {
  /** Channel count from the OpusHead identification header. */
  channels: number;
  /** Whole seconds, derived from the final page's granule position. */
  seconds: number;
}

/**
 * Parse channel count and duration from an Ogg/Opus stream.
 *
 * Returns null for anything that is not a readable Ogg/Opus stream — a
 * truncated buffer, a missing OpusHead, or a container we cannot measure.
 * Callers treat null as "do not send this as audio".
 */
export function parseOggOpus(bytes: Uint8Array): OggOpusInfo | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 28 || buf.toString("latin1", 0, 4) !== "OggS") return null;

  // OpusHead layout: magic(8) + version(1) + channel count(1).
  const head = buf.indexOf("OpusHead");
  if (head < 0 || head + 10 > buf.length) return null;
  const channels = buf[head + 9] ?? 0;

  // Duration = last page's granule position (u64le at page offset +6) / 48kHz.
  let page = -1;
  let lastPage = -1;
  while (true) {
    page = buf.indexOf("OggS", page + 1);
    if (page < 0) break;
    lastPage = page;
  }
  if (lastPage < 0 || lastPage + 14 > buf.length) return null;

  const granule = Number(buf.readBigUInt64LE(lastPage + 6));
  return { channels, seconds: Math.max(1, Math.round(granule / 48000)) };
}
