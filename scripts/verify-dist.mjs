#!/usr/bin/env node
//
// verify-dist.mjs — load the BUILT plugin exactly as opencode would (ESM import
// of dist/index.js) and invoke it, so packaging regressions (directory imports,
// extensionless relative imports, a broken tool() call) fail loudly here instead
// of breaking opencode startup. Run after `tsc`; exits non-zero on any problem.

import path from "node:path"
import { pathToFileURL } from "node:url"

const dist = path.resolve("dist/index.js")

function fail(msg) {
  console.error(`verify-dist: ${msg}`)
  process.exit(1)
}

const mod = await import(pathToFileURL(dist).href).catch((e) => fail(`dist/index.js failed to import: ${e.message}`))
if (typeof mod.default !== "function") fail("default export is not a plugin function")

const fakeClient = { session: {}, app: { agents: async () => ({ data: [{ name: "general" }, { name: "build" }] }) } }
const input = {
  client: fakeClient, directory: process.cwd(), worktree: process.cwd(),
  $: {}, project: {}, serverUrl: new URL("http://localhost"), experimental_workspace: { register() {} },
}

// Settings arrive as the plugin entry's options (second argument).
const options = { autoMode: { enabled: true }, ultracode: { enabled: true } }
let hooks
try {
  hooks = await mod.default(input, options)
} catch (e) {
  fail(`invoking the plugin threw: ${e && e.stack ? e.stack : e}`)
}

const requiredHooks = ["tool", "permission.ask", "tool.execute.before", "tool.execute.after", "chat.message", "chat.params", "command.execute.before", "event"]
const missing = requiredHooks.filter((h) => !(h in hooks))
if (missing.length) fail(`missing hooks: ${missing.join(", ")}`)
if (!hooks.tool?.workflow || !hooks.tool["workflow-manager"]) fail("missing workflow / workflow-manager tools")

console.log("verify-dist: OK — dist/index.js imports and builds all hooks + tools from plugin options.")
