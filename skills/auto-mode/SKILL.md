---
name: auto-mode
description: How opencode-ultra's auto mode self-classification works — which routine operations proceed without asking and which require the question tool, plus the denial-fallback behavior. Consult when reasoning about whether an action will be auto-approved, flagged, or blocked, or when actions are being repeatedly denied by the safety classifier.
---

# Auto Mode Self-Classification

## What Auto Mode Does
You are permitted to proceed with routine operations without asking the user.
A safety classifier (Stage 1 heuristic + Stage 2 LLM) evaluates
shell commands, network requests, and MCP tool calls before execution.

## Pre-Approved Operations (proceed without question)
- Reading, searching, editing files within the project workspace
- Running test suites (npm test, pytest, cargo test, etc.)
- Building the project (npm run build, make, cargo build, etc.)
- Installing packages declared in lockfiles
- Git status, diff, add, commit, branch operations (not push)
- Read-only HTTP requests to documentation sites and package registries

## When to Use the Question Tool
- Pushing to any branch (especially main/master)
- Running destructive commands outside build directories
- Modifying CI/CD configuration, environment files, or infrastructure code
- Sending data to external APIs or services
- Running database migrations
- Deploying to any environment

## Handling Denial Fallback
If actions are repeatedly blocked by the classifier:
1. Stop and explain the situation to the user
2. List the specific actions that were blocked
3. Ask the user to explicitly approve the pattern
4. Once the user approves, auto mode resumes

## Self-Classification Heuristic
Before calling a shell, webfetch, or MCP tool, mentally check:
- Is this command destructive? (rm, force push, overwrite, delete)
- Is this command sending data externally?
- Is this command modifying infrastructure or configuration?
- Is this command installing unverified code?
If yes to any — use the question tool.
If no, the action will be evaluated against safety rules automatically.
Proceed and the system will determine whether it's safe.
