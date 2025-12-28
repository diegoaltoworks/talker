import { describe, expect, it } from "bun:test";
import { getDefaultVoices, getVoiceConfig } from "./voice";

describe("getVoiceConfig", () => {
  it("should return English voice by default", () => {
    const config = getVoiceConfig("en");
    expect(config.voice).toBe("Polly.Brian");
    expect(config.language).toBe("en-GB");
  });

  it("should return French voice for fr", () => {
    const config = getVoiceConfig("fr");
    expect(config.voice).toBe("Polly.Mathieu");
    expect(config.language).toBe("fr-FR");
  });

  it("should return Portuguese voice for pt", () => {
    const config = getVoiceConfig("pt");
    expect(config.voice).toBe("Polly.Ricardo");
    expect(config.language).toBe("pt-BR");
  });

  it("should return Dutch voice for nl", () => {
    const config = getVoiceConfig("nl");
    expect(config.voice).toBe("Polly.Ruben");
    expect(config.language).toBe("nl-NL");
  });

  it("should return German voice for de", () => {
    const config = getVoiceConfig("de");
    expect(config.voice).toBe("Polly.Hans");
    expect(config.language).toBe("de-DE");
  });

  it("should return Spanish voice for es", () => {
    const config = getVoiceConfig("es");
    expect(config.voice).toBe("Polly.Enrique");
    expect(config.language).toBe("es-ES");
  });

  it("should fall back to English for unknown languages", () => {
    const config = getVoiceConfig("xx");
    expect(config.voice).toBe("Polly.Brian");
    expect(config.language).toBe("en-GB");
  });

  it("should use custom voices when provided", () => {
    const customVoices = {
      en: { voice: "Polly.Amy", language: "en-US" },
    };
    const config = getVoiceConfig("en", customVoices);
    expect(config.voice).toBe("Polly.Amy");
    expect(config.language).toBe("en-US");
  });

  it("should fall back to defaults when custom voice not found for language", () => {
    const customVoices = {
      en: { voice: "Polly.Amy", language: "en-US" },
    };
    const config = getVoiceConfig("fr", customVoices);
    expect(config.voice).toBe("Polly.Mathieu");
    expect(config.language).toBe("fr-FR");
  });
});

describe("getDefaultVoices", () => {
  it("should return all default voices", () => {
    const voices = getDefaultVoices();
    expect(Object.keys(voices)).toEqual(["en", "fr", "nl", "de", "es", "pt"]);
  });

  it("should return a copy (not the original object)", () => {
    const voices = getDefaultVoices();
    voices.en = { voice: "modified", language: "modified" };
    const voices2 = getDefaultVoices();
    expect(voices2.en.voice).toBe("Polly.Brian");
  });
});
