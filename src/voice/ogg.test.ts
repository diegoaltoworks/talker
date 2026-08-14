import { describe, expect, it } from "bun:test";
import { parseOggOpus } from "./ogg";
import { concatBytes, oggOpusStream, oggPage, opusHead } from "./ogg.fixtures";

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

  it("reads a view into a larger buffer without spilling into its neighbours", () => {
    const stream = oggOpusStream(1, 48000 * 5);
    const backing = new Uint8Array(stream.length + 64).fill(0xff);
    backing.set(stream, 32);
    const view = backing.subarray(32, 32 + stream.length);
    expect(parseOggOpus(view)).toEqual({ channels: 1, seconds: 5 });
  });
});
