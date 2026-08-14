/**
 * Ogg/Opus container inspection.
 *
 * Pure functions, zero dependencies — no I/O, no env, no clients. Used to fill
 * the duration field of a voice-note bubble and as a regression check that TTS
 * output stayed mono (some mobile clients refuse stereo voice notes).
 *
 * Inbound audio is attacker-controlled, so this walks the page structure via
 * the segment table rather than scanning for the `OggS` capture pattern. A
 * scan would let those four bytes appearing inside packet payload masquerade
 * as a page header, and the granule read from that offset — arbitrary audio
 * data — would become the reported duration.
 */

/** Ogg page header, up to but excluding the segment table. */
const PAGE_HEADER_BYTES = 27;
const CAPTURE_PATTERN = "OggS";
const IDENTIFICATION_MAGIC = "OpusHead";
/** Opus granule positions are always counted at 48kHz, whatever the input rate. */
const OPUS_SAMPLE_RATE = 48000;
/** Spec sentinel: no packet completes on this page, so it carries no timing. */
const UNKNOWN_GRANULE = 0xffffffffffffffffn;
/** Sanity ceiling — anything longer is a corrupt granule, not a voice note. */
const MAX_MEASURABLE_SECONDS = 4 * 60 * 60;

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
 * truncated buffer, a missing or malformed OpusHead, a page whose segment
 * table runs past the end, or a granule we cannot trust (the unknown-position
 * sentinel, or a value implying an implausible duration). Callers treat null
 * as "do not send this as audio".
 */
export function parseOggOpus(bytes: Uint8Array): OggOpusInfo | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < PAGE_HEADER_BYTES) return null;

  let offset = 0;
  let channels: number | null = null;
  let lastGranule: bigint | null = null;

  // Walk page by page. Every page's length is fully determined by its segment
  // table, so payload bytes are stepped over rather than searched.
  while (offset + PAGE_HEADER_BYTES <= buf.length) {
    if (buf.toString("latin1", offset, offset + 4) !== CAPTURE_PATTERN) return null;
    if (buf[offset + 4] !== 0) return null; // unknown page structure version

    const segmentCount = buf[offset + 26] ?? 0;
    const payloadStart = offset + PAGE_HEADER_BYTES + segmentCount;
    if (payloadStart > buf.length) return null;

    let payloadBytes = 0;
    for (let i = offset + PAGE_HEADER_BYTES; i < payloadStart; i++) {
      payloadBytes += buf[i] ?? 0;
    }
    const pageEnd = payloadStart + payloadBytes;
    if (pageEnd > buf.length) return null; // truncated final page

    if (channels === null) {
      // The identification header is the first page's payload and nowhere
      // else; anchoring here stops a payload-embedded "OpusHead" from
      // standing in for a real one.
      if (payloadStart + 10 > buf.length) return null;
      if (buf.toString("latin1", payloadStart, payloadStart + 8) !== IDENTIFICATION_MAGIC) {
        return null;
      }
      channels = buf[payloadStart + 9] ?? 0;
      if (channels === 0) return null;
    }

    const granule = buf.readBigUInt64LE(offset + 6);
    if (granule !== UNKNOWN_GRANULE) lastGranule = granule;

    offset = pageEnd;
  }

  if (channels === null || lastGranule === null) return null;

  // The granule includes OpusHead's pre-skip (typically ~6.5ms), which is well
  // below the whole-second resolution reported here — deliberately not
  // subtracted.
  const seconds = Math.round(Number(lastGranule) / OPUS_SAMPLE_RATE);
  if (seconds > MAX_MEASURABLE_SECONDS) return null;
  return { channels, seconds: Math.max(1, seconds) };
}
