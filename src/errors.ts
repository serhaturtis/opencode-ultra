/**
 * Typed errors — every failure mode in opencode-ultra has a dedicated error class.
 * No generic Error throws. Callers can match on error type for precise handling.
 */

// ── Auto Mode ────────────────────────────────────────────────────────────────

export class ToolDeniedError extends Error {
  constructor(
    message: string,
    public readonly tool: string,
    public readonly callId?: string,
  ) {
    super(message)
    this.name = "ToolDeniedError"
  }
}

// ── Ultracode ────────────────────────────────────────────────────────────────

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly errors: readonly string[],
  ) {
    super(message)
    this.name = "WorkflowParseError"
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(public readonly workflowId: string) {
    super(`Workflow ${workflowId} not found`)
    this.name = "WorkflowNotFoundError"
  }
}

export class WorkflowLimitError extends Error {
  constructor(
    public readonly max: number,
    public readonly current: number,
  ) {
    super(`Max ${max} concurrent workflows. ${current} currently running.`)
    this.name = "WorkflowLimitError"
  }
}
