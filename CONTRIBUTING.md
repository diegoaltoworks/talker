# Contributing to Talker

Thank you for your interest in contributing to Talker! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct (see CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include as many details as possible using our bug report template.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Create an issue using the feature request template and provide:

- A clear and descriptive title
- A detailed description of the proposed feature
- Examples of how the feature would be used
- Why this enhancement would be useful

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue the pull request!

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- Node.js 24+ (for compatibility testing)

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/talker.git
cd talker

# Install dependencies
bun install
```

### Development Workflow

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Type check
bun run typecheck

# Lint
bun run lint

# Fix linting issues
bun run lint:fix

# Build
bun run build

# Run all checks
bun run check
```

## Project Structure

```
talker/
  src/
    core/              Context, TwiML, voice, phrases, processing pipeline
    core/processing/   OpenAI-powered incoming/outgoing message processors
    core/chatbot/      HTTP client for remote chatbot APIs
    flows/             Flow engine (intent detection, parameter extraction)
    routes/call/       Hono handlers for voice call webhooks
    routes/sms/        Hono handlers for SMS webhooks
    adapters/          Twilio REST API client
    db/                Session persistence (Turso/libSQL)
    plugin.ts          Chatter plugin entry point
    standalone.ts      Standalone server entry point
    types.ts           TypeScript type definitions
  examples/            Ready-to-run usage examples
  language/            Built-in phrase files (6 languages)
  prompts/             Default system prompts
  test/integration/    Integration tests
```

## Coding Guidelines

### TypeScript

- Use TypeScript for all new code
- Prefer interfaces over types for object shapes
- Use strict mode
- Document public APIs with JSDoc comments

### Code Style

- Use Biome for linting and formatting
- 2 spaces for indentation
- Double quotes for strings
- Semicolons required
- Max line length: 100 characters

### Testing

- Write unit tests co-located with modules (`*.test.ts` next to source)
- Integration tests go in `test/integration/`
- Integration tests that need external services should skip when env vars are missing
- Use descriptive test names
- Group related tests with `describe` blocks

### Commits

- Use clear and meaningful commit messages
- Follow conventional commits format:
  - `feat: add new feature`
  - `fix: resolve bug`
  - `docs: update documentation`
  - `test: add tests`
  - `refactor: restructure code`
  - `chore: maintenance tasks`

## Pull Request Process

1. **Update Documentation**: Update README.md and relevant docs for any new features
2. **Add Tests**: Ensure new code is covered by tests
3. **Pass CI**: All tests, linting, and type checks must pass
4. **Update Changelog**: Add entry to CHANGELOG.md under "Unreleased"
5. **Request Review**: Tag maintainers for review

## Release Process

Releases are automated via GitHub Actions:

1. Push to `main` branch
2. CI workflow runs all checks
3. On CI success, the publish workflow:
   - Bumps the minor version
   - Publishes to NPM
   - Creates a GitHub release with auto-generated notes

## Questions?

Feel free to:
- Open an issue for questions
- Start a discussion in GitHub Discussions
- Email: diego@diegoalto.works

Thank you for contributing!
