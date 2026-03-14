# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-03-14

### Added

- Chatter plugin mode via `createTelephonyRoutes`
- Standalone server mode via `createStandaloneServer`
- Voice call support with Twilio webhooks (speech-to-text, TTS, conversation loops)
- SMS support with inbound/outbound messaging
- OpenAI-powered pre/post-processing pipeline (language detection, STT cleanup, channel formatting, translation)
- Structured flow engine with LLM intent detection and parameter extraction
- Human handoff with automatic transfer detection
- Multi-language support (English, French, German, Dutch, Spanish, Portuguese)
- Session persistence to Turso/libSQL (`talker_sessions`, `talker_messages` tables)
- HTTP chatbot client for remote API integration (standalone mode)
- In-memory conversation context management with TTL cleanup
- Configurable TTS voices per language (Amazon Polly defaults)
- Async acknowledgment pattern ("one moment please")
- No-speech retry logic with configurable max retries
