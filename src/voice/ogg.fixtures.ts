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
  if (payload.length > 255) {
    throw new Error(
      "fixture payload exceeds one segment (255 bytes) — this builder does not do segment continuation",
    );
  }
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

/** An OpusTags comment header page carrying the given "KEY=value" strings. */
export function opusTags(comments: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const vendor = encoder.encode("fixture");
  const uint32 = (n: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, n, true);
    return bytes;
  };
  const parts = [
    encoder.encode("OpusTags"),
    uint32(vendor.length),
    vendor,
    uint32(comments.length),
  ];
  for (const comment of comments) {
    const bytes = encoder.encode(comment);
    parts.push(uint32(bytes.length), bytes);
  }
  return concatBytes(...parts);
}

/**
 * An OpusTags page carrying one comment field whose declared length is
 * larger than the bytes actually present. Page framing (the segment table)
 * is intact and correct — only the field-length header inside the payload
 * lies, exercising the inner bounds check separately from truncated framing.
 */
export function opusTagsWithOversizedField(comment: string, declaredLength: number): Uint8Array {
  const encoder = new TextEncoder();
  const vendor = encoder.encode("fixture");
  const uint32 = (n: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, n, true);
    return bytes;
  };
  return concatBytes(
    encoder.encode("OpusTags"),
    uint32(vendor.length),
    vendor,
    uint32(1),
    uint32(declaredLength),
    encoder.encode(comment),
  );
}

/**
 * A complete stream with a comment (OpusTags) page between the identification
 * header and the audio page — the layout real Ogg/Opus encoders produce.
 */
export function oggOpusStreamWithComments(
  channels: number,
  granule: number,
  comments: string[],
): Uint8Array {
  return concatBytes(
    oggPage(0, opusHead(channels)),
    oggPage(0, opusTags(comments)),
    oggPage(granule, new Uint8Array([0x00])),
  );
}

/**
 * A page whose granule is the spec's unknown-position sentinel — legal, and
 * meaning "no packet completes here", so it carries no timing.
 */
export function unknownGranulePage(payload: Uint8Array): Uint8Array {
  const page = oggPage(0, payload);
  new DataView(page.buffer).setBigUint64(6, 0xffffffffffffffffn, true);
  return page;
}

/**
 * An audio page whose *payload* contains the bytes a naive scanner would take
 * for a page header: the capture pattern followed by a granule implying
 * `fakeSeconds`. A page walk steps over it; a byte scan reads it as the last
 * page.
 */
export function pageWithDecoyInPayload(granule: number, fakeSeconds: number): Uint8Array {
  const decoy = new Uint8Array(20);
  decoy.set(new TextEncoder().encode("OggS"), 0);
  decoy[4] = 0;
  new DataView(decoy.buffer).setBigUint64(6, BigInt(48000 * fakeSeconds), true);
  return oggPage(granule, decoy);
}
