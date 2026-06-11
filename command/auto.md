---
description: Toggle auto mode
---

Toggle auto mode for the current session.

Usage: /auto [on|off|status|defaults|config]

- /auto         — Enable auto mode
- /auto off     — Disable auto mode
- /auto status  — Show: active/paused, denial count
- /auto defaults— Show built-in safety rules
- /auto config  — Show effective config with overrides applied

When active, routine operations proceed without asking.
Shell commands, network requests, and MCP tools are classified
by a two-stage safety pipeline before execution.
