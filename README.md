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

When enabled, the extension auto-compacts after a prompt finishes if context usage approaches the configured limit. If you send the next prompt while compaction is still needed or running, the extension queues that prompt and replays it after compaction completes.

This is a soft limit: Pi's compaction settings, current model, system prompt, tools, and recent messages determine the final context size.

## Install

```bash
pi install npm:max-context
```

Or install from GitHub:

```bash
pi install git:github.com/indie-arch/max-context
```
