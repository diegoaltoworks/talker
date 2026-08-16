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
    routes/messaging/  Hono handlers for SMS and WhatsApp webhooks
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
- No em-dashes, in code, docs, commit messages, or PR text - use a plain
  hyphen with spaces, a comma, a colon, or restructure the sentence.
  Enforced as a ratchet by `bun run check:em-dashes`
  (`scripts/check-em-dashes.ts`): it fails if the total grows past its
  baseline, and the baseline should shrink whenever a touched file loses
  one of the pre-existing occurrences it hasn't caught up to yet

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
- Mark a breaking change with `!` before the colon (`feat!:`, `fix(api)!:`)
  or a `BREAKING CHANGE:` footer in the commit body. Past 1.0 this ships a
  major version; before 1.0 it still only reaches minor (see Release
  Process). The subject that drives the version on `main` is the squash-merge
  commit's, which is the PR title - so put the marker in the PR title, not
  only in a commit on the branch.

## Deprecating a public name

Nothing exported from the package root is deleted without a deprecation
window first. A deprecation is a promise with a date on it, so:

1. Tag the old name `@deprecated`, and say **which version removes it** as a
   literal: `@deprecated Removed in 1.0.0. Use \`getChannelPhrase\`.` A tag
   that says a name "may be dropped in a future release without notice" is a
   disclaimer, not a deprecation - a host reading it cannot tell whether to
   migrate this week or ignore it for a year.
2. Keep the old name working as a thin wrapper over the new one. Deprecated
   is not broken.
3. Rewire this package's own callers to the new name in the same PR, so the
   deprecated path has no internal users left holding it up.
4. Remove it in the version the tag named, not before and not silently later.

`bun run check:deprecations` (`scripts/deprecations.ts`, part of `bun run
check`) enforces steps 1 and 4's precondition: every `@deprecated` in `src/`
must name a removal version and may not hedge. A name that was never
reachable from the package root is not a public API and does not need a
window - delete it.

## Definition of Done

What "done" requires depends on what kind of change it is. All of them
require `bun run check` green; the rest is per type:

| Change type | Also requires |
|---|---|
| **Feature** | Tests for every new branch, including failure paths (see `src/voice/ladder.test.ts` for the shape: one test per fallback). User-facing strings added to `language/*.json`, never hardcoded. A doc update if it changes behavior a host configures or depends on (README, `docs/ARCHITECTURE.md`, or both). |
| **Bug fix** | A regression test that fails without the fix and passes with it. If the bug was a violated invariant (see `docs/ARCHITECTURE.md`), consider whether it needs a standing guard test like `src/peer-deps.test.ts`, not just a one-off case. |
| **Docs / chore** | No behavior change, so no new tests - but if the doc describes a number (a timeout, a limit, a count), it must match what the code actually does; don't restate a constant without checking it. |

Two things apply across all types:

- **Numbers are tested, not just documented.** A timeout, budget, rate
  limit, or char limit that governs perceivable behavior needs a test
  pinning its value - see `docs/ARCHITECTURE.md`'s "No-untested-numbers
  rule".
- **New capability modules follow `src/voice/`'s shape**: injected
  clients, no `process.env` reads, `null` (not a throw) on the
  disabled/failure path. `docs/ARCHITECTURE.md`'s "Exemplar patterns"
  section has the short list of patterns worth copying, including
  `src/core/chat.test.ts`'s hermetic-test pattern for tests that exercise a
  real dependency instead of a hand-rolled mock.

## Pull Request Process

1. **Update Documentation**: Update README.md and relevant docs for any new features
2. **Add Tests**: Ensure new code is covered by tests
3. **Pass CI**: All tests, linting, and type checks must pass
4. **Update Changelog** (notable or breaking changes only): add an entry under
   `[Unreleased]` in CHANGELOG.md. Every merge to `main` publishes immediately
   (see below), so the version your change ships as is not known at PR time -
   a maintainer moves the entry from `[Unreleased]` into a versioned section
   once the release tag exists. Most day-to-day fixes don't need an entry at
   all: from `v0.46.0` onward, [GitHub Releases](https://github.com/diegoaltoworks/talker/releases)
   auto-generates the complete per-version log from every merged PR title, and
   CHANGELOG.md exists to curate the subset worth a human-written summary.
5. **Request Review**: Tag maintainers for review

## Release Process

Releases are automated via GitHub Actions. `main` is protected, so every
release starts from a reviewed pull request:

1. Merge a PR into `main` (direct pushes are refused by the `main-protection`
   ruleset)
2. CI workflow runs all checks
3. On CI success, the publish workflow:
   - Refuses to continue if an unreviewed dependency change is waiting to ship
     (see below)
   - Re-runs the same gates (`bun run check`), builds, and smoke-tests the
     packed tarball
   - Derives the version from the conventional-commit subjects since the last
     release tag - any `feat:` ships a minor, anything else ships a patch.
     A breaking change (a `!` before the colon, or a `BREAKING CHANGE:` /
     `BREAKING-CHANGE:` footer) ships a major once the package is past 1.0;
     below 1.0.0 it still only reaches minor, since semver leaves 0.x
     compatibility undefined and minor is already the strongest signal the
     range has. See `scripts/next-version.ts`
   - Tags the release, publishes to NPM, and creates the GitHub release with
     auto-generated notes

The **tag is the record of what shipped**: it names a commit carrying the
bumped `package.json`, so `git checkout v<x.y.z>` reads the published version.
The `package.json` on `main` only tracks it when the optional `RELEASE_PAT`
secret (a repo admin's token, which bypasses the ruleset) is configured;
without it the checked-in version is a floor, not the latest release.

### Dependency bumps

Dependabot PRs auto-merge, so nobody reads the diff before CI goes green.
`scripts/release-guard.ts` therefore blocks the automated publish when an
unreleased dependabot commit touched anything beyond a manifest or lockfile -
a workflow or Dockerfile bump changes what runs, and that needs a human.
Manifest-only bumps ride along with the next release, so the guard can never
wedge the release train against itself.

To ship a blocked change: read it, then run the **Publish to NPM** workflow
from the Actions tab. Dispatching is the approval, and it moves the release tag
past the commit.

## Questions?

Feel free to:
- Open an [issue](https://github.com/diegoaltoworks/talker/issues) for
  questions or discussion
- Email: diego@diegoalto.works

Thank you for contributing!
