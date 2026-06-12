# max-context

Pi extension to cap context usage with a `/max-context` command.

## Usage

- `/max-context 256k`
- `/max-context 128000`
- `/max-context off`

When enabled, the extension auto-compacts before the next turn when context usage approaches the configured limit.

## Install

```bash
pi install git:github.com/indie-arch/max-context
```
