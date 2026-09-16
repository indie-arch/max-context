# max-context

Pi extension to keep context usage near a configurable soft limit with a `/max-context` command.

## Usage

- `/max-context 256k`
- `/max-context 128000`
- `/max-context 1.5m`
- `/max-context off`
- `/max-context status off` — hide the plugin's status bar info
- `/max-context status on` — show it again (default)

Status visibility does not affect auto-compaction. The preference lasts for the current Pi process and resets to shown on restart. Status info is only displayed when a soft limit is set.

When enabled, the extension auto-compacts after a prompt finishes if context usage approaches the configured limit. A prompt that triggers compaction is held and replayed afterward, with skill and prompt-template expansion preserved. While compaction is running, Pi's interactive UI queues new submissions; the extension also holds input events delivered before its compaction callback completes. RPC/API clients must wait for compaction to finish before submitting prompts, as Pi rejects those submissions before extension input handlers run.

This is a soft limit: Pi's compaction settings, current model, system prompt, tools, and recent messages determine the final context size.

Successful compaction rearms the soft limit using the resulting context size. If compaction fails or leaves usage above the threshold, retries wait for further growth to avoid a loop. Switching sessions clears pending input and compaction retry state; the configured limit remains enabled.

## Development

Run `npm test` with Node.js 22.13+ (or Node.js 24+) for the compaction and input-queue regression tests.

## Install

```bash
pi install npm:max-context
```

Or install from GitHub:

```bash
pi install git:github.com/indie-arch/max-context
```
