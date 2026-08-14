/**
 * Ogg/Opus byte fixtures for tests.
 *
 * Builds real container bytes rather than checking in a binary blob, so the
 * channel count and duration under test are visible in the test itself. Not
 * exported from the package root — test scaffolding only.
 */

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * One Ogg page: the 27-byte header, a one-entry segment table, and the
 * payload. Only the fields the parser reads (capture pattern, granule) need to
 * be faithful; serial, sequence and CRC are inert here.
 */
export function oggPage(granule: number, payload: Uint8Array): Uint8Array {
  const page = new Uint8Array(28 + payload.length);
  const view = new DataView(page.buffer);
  page.set(new TextEncoder().encode("OggS"), 0);
  page[4] = 0; // stream structure version
  page[5] = 0; // header type
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, 1, true); // serial number
  view.setUint32(18, 0, true); // page sequence
  view.setUint32(22, 0, true); // checksum (unchecked by the parser)
  page[26] = 1; // one segment
  page[27] = payload.length;
  page.set(payload, 28);
  return page;
}

/** An OpusHead identification header with the given channel count. */
export function opusHead(channels: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1; // version
  head[9] = channels;
  return head;
}

/** A complete stream: an OpusHead page plus an audio page carrying `granule`. */
export function oggOpusStream(channels: number, granule: number): Uint8Array {
  return concatBytes(oggPage(0, opusHead(channels)), oggPage(granule, new Uint8Array([0x00])));
}
