import { describe, expect, it } from "bun:test";
import { findSuspiciousOggComments, parseOggOpus } from "./ogg";
import {
  concatBytes,
  oggOpusStream,
  oggOpusStreamWithComments,
  oggPage,
  opusHead,
  opusTags,
  opusTagsWithOversizedField,
  pageWithDecoyInPayload,
  unknownGranulePage,
} from "./ogg.fixtures";

describe("parseOggOpus", () => {
  it("reads the channel count from OpusHead", () => {
    expect(parseOggOpus(oggOpusStream(1, 48000))?.channels).toBe(1);
  });

  it("reports stereo so callers can refuse it", () => {
    expect(parseOggOpus(oggOpusStream(2, 48000))?.channels).toBe(2);
  });

  it("derives duration from the last page granule at 48kHz", () => {
    expect(parseOggOpus(oggOpusStream(1, 48000 * 7))?.seconds).toBe(7);
  });

  it("rounds fractional durations to whole seconds", () => {
    expect(parseOggOpus(oggOpusStream(1, 48000 * 3.4))?.seconds).toBe(3);
    expect(parseOggOpus(oggOpusStream(1, 48000 * 3.6))?.seconds).toBe(4);
  });

  it("floors sub-second audio at one second rather than zero", () => {
    expect(parseOggOpus(oggOpusStream(1, 100))?.seconds).toBe(1);
  });

  it("uses the final page's granule, not the first", () => {
    const stream = concatBytes(
      oggPage(0, opusHead(1)),
      oggPage(48000, new Uint8Array([0x00])),
      oggPage(48000 * 12, new Uint8Array([0x00])),
    );
    expect(parseOggOpus(stream)?.seconds).toBe(12);
  });

  it("returns null when the capture pattern is missing", () => {
    const notOgg = oggOpusStream(1, 48000);
    notOgg.set(new TextEncoder().encode("RIFF"), 0);
    expect(parseOggOpus(notOgg)).toBeNull();
  });

  it("returns null when OpusHead is absent", () => {
    expect(parseOggOpus(oggPage(48000, new Uint8Array(19)))).toBeNull();
  });

  it("returns null for a buffer too short to hold a page header", () => {
    expect(parseOggOpus(new TextEncoder().encode("OggS"))).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseOggOpus(new Uint8Array(0))).toBeNull();
  });

  // Inbound audio is attacker-controlled, so a payload must never be able to
  // pose as container structure.
  describe("malformed and adversarial input", () => {
    it("ignores capture-pattern bytes embedded in a page payload", () => {
      const stream = concatBytes(oggPage(0, opusHead(1)), pageWithDecoyInPayload(48000 * 5, 9999));
      // The decoy claims 9999s; the real final page granule is 5s.
      expect(parseOggOpus(stream)?.seconds).toBe(5);
    });

    it("ignores an OpusHead that is not the first page's payload", () => {
      const fakeHead = concatBytes(new Uint8Array(4), opusHead(7));
      const stream = concatBytes(oggPage(0, fakeHead), oggPage(48000, new Uint8Array([0x00])));
      expect(parseOggOpus(stream)).toBeNull();
    });

    it("never reads the unknown-granule sentinel as a duration", () => {
      const stream = concatBytes(oggPage(0, opusHead(1)), unknownGranulePage(new Uint8Array(1)));
      // Read as an unsigned integer the sentinel is ~384 trillion seconds. The
      // sentinel page is skipped, leaving only the header page's granule of 0,
      // which the one-second floor reports as 1.
      expect(parseOggOpus(stream)).toEqual({ channels: 1, seconds: 1 });
    });

    it("falls back to the last page that carries real timing", () => {
      const stream = concatBytes(
        oggPage(0, opusHead(1)),
        oggPage(48000 * 6, new Uint8Array([0x00])),
        unknownGranulePage(new Uint8Array([0x00])),
      );
      expect(parseOggOpus(stream)?.seconds).toBe(6);
    });

    it("returns null for an implausible duration rather than reporting it", () => {
      expect(parseOggOpus(oggOpusStream(1, 48000 * 60 * 60 * 5))).toBeNull();
    });

    it("returns null when a page's payload runs past the end of the buffer", () => {
      const stream = oggOpusStream(1, 48000);
      expect(parseOggOpus(stream.subarray(0, stream.length - 1))).toBeNull();
    });

    it("returns null when the segment table runs past the end of the buffer", () => {
      const stream = oggOpusStream(1, 48000);
      stream[26] = 250; // claim 250 segments the buffer cannot hold
      expect(parseOggOpus(stream)).toBeNull();
    });

    it("returns null for an unknown page structure version", () => {
      const stream = oggOpusStream(1, 48000);
      stream[4] = 9;
      expect(parseOggOpus(stream)).toBeNull();
    });

    it("returns null for a zero-channel identification header", () => {
      expect(parseOggOpus(oggOpusStream(0, 48000))).toBeNull();
    });
  });

  it("reads a view into a larger buffer without spilling into its neighbours", () => {
    const stream = oggOpusStream(1, 48000 * 5);
    const backing = new Uint8Array(stream.length + 64).fill(0xff);
    backing.set(stream, 32);
    const view = backing.subarray(32, 32 + stream.length);
    expect(parseOggOpus(view)).toEqual({ channels: 1, seconds: 5 });
  });
});

describe("findSuspiciousOggComments", () => {
  it("returns an empty array for ordinary encoder comments", () => {
    const stream = oggOpusStreamWithComments(1, 48000, ["ENCODER=Lavc61.19.100 libopus"]);
    expect(findSuspiciousOggComments(stream)).toEqual([]);
  });

  it("flags MP4/QuickTime container fields carried over by a lossy transcode", () => {
    const stream = oggOpusStreamWithComments(1, 48000, [
      "major_brand=isom",
      "compatible_brands=isomiso2avc1mp41",
      "ENCODER=Lavc61.19.100 libopus",
    ]);
    expect(findSuspiciousOggComments(stream)).toEqual(["major_brand", "compatible_brands"]);
  });

  it("flags reverse-DNS-style keys as never a standard Vorbis comment field", () => {
    const stream = oggOpusStreamWithComments(1, 48000, ["com.android.version=14"]);
    expect(findSuspiciousOggComments(stream)).toEqual(["com.android.version"]);
  });

  it("returns null when there is no comment page at all", () => {
    expect(findSuspiciousOggComments(oggOpusStream(1, 48000))).toBeNull();
  });

  it("returns null for a buffer too short to hold a page header", () => {
    expect(findSuspiciousOggComments(new TextEncoder().encode("OggS"))).toBeNull();
  });

  it("returns null when the comment page itself is truncated", () => {
    const stream = oggOpusStreamWithComments(1, 48000, ["TITLE=ok"]);
    // Cut inside the comment page's own framing (past the identification
    // page, short of the trailing audio page) so the page walk's own
    // pageEnd-past-buffer guard fires before the comment fields are read.
    expect(findSuspiciousOggComments(stream.subarray(0, stream.length - 40))).toBeNull();
  });

  it("returns null when a comment's declared field length overruns the page", () => {
    // Page framing (the segment table) is intact and correct; only the
    // field-length header inside the OpusTags payload lies about how many
    // bytes follow, exercising parseCommentPage's inner bounds check.
    const commentPage = oggPage(0, opusTagsWithOversizedField("TITLE=ok", 9999));
    const stream = concatBytes(
      oggPage(0, opusHead(1)),
      commentPage,
      oggPage(48000, new Uint8Array([0x00])),
    );
    expect(findSuspiciousOggComments(stream)).toBeNull();
  });

  it("returns null when the second page is not a real OpusTags header", () => {
    // A non-Opus stream whose second page happens to start with the
    // OpusTags magic must not be mistaken for a real comment header — the
    // first page has to check out as OpusHead first.
    const stream = concatBytes(
      oggPage(0, new Uint8Array(19)),
      oggPage(0, opusTags(["major_brand=isom"])),
      oggPage(48000, new Uint8Array([0x00])),
    );
    expect(findSuspiciousOggComments(stream)).toBeNull();
  });

  it("does not affect parseOggOpus's own result when comments are present", () => {
    const stream = oggOpusStreamWithComments(1, 48000 * 3, ["major_brand=isom"]);
    expect(parseOggOpus(stream)).toEqual({ channels: 1, seconds: 3 });
  });
});
