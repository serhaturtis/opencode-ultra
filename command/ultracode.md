---
description: Toggle ultracode workflow mode
---

Toggle ultracode workflow orchestration for the current session.

Usage: /ultracode [on|off|status]

- /ultracode        — Enable ultracode mode
- /ultracode off    — Disable ultracode mode
- /ultracode status — Show current state

When active, the model proactively uses the workflow tool for tasks
spanning 3+ files. Sets maximum reasoning effort automatically.

Use `ultracode:` prefix in any message to trigger workflow mode
for that single request only.
