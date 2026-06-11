/**
 * Workflow manager tool — list / output / pause / resume / stop / save.
 * Renders LIVE per-agent progress (not just a final summary), so long runs are
 * never opaque.
 */
import { tool } from "@opencode-ai/plugin"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { type UltraState, type WorkflowJob } from "../contracts.js"
import { completeJob } from "../state.js"
import { saveWorkflowAsCommand } from "./command-saver.js"
import { WorkflowNotFoundError } from "../errors.js"

export function createWorkflowManagerTool(state: UltraState) {
  return tool({
    description: `Manage running workflows: list, view live progress/output, pause, resume, stop, save.`,
    args: {
      action: tool.schema.string().describe("'list' | 'output' | 'pause' | 'resume' | 'stop' | 'save'"),
      workflowId: tool.schema.string().optional(),
      commandName: tool.schema.string().optional(),
    },
    execute: async (args) => {
      if (args.action === "list") {
        return { title: "Workflows", output: formatWorkflowList(state), metadata: {} }
      }
      if (!args.workflowId) throw new Error("'workflowId' is required for this action")
      const job = state.workflows.jobs.get(args.workflowId)
        ?? state.workflows.completedJobs.find((j) => j.id === args.workflowId)
      if (!job) throw new WorkflowNotFoundError(args.workflowId)

      switch (args.action) {
        case "output":
          return { title: `Workflow: ${job.title}`, output: renderProgress(job), metadata: { status: job.status } }
        case "pause":
          job.pause()
          return { title: "Workflow paused", output: `Paused: ${job.title}`, metadata: { status: job.status } }
        case "resume":
          job.resume()
          return { title: "Workflow resumed", output: `Resumed: ${job.title}`, metadata: { status: job.status } }
        case "stop":
          job.stop()
          completeJob(state, job)
          return { title: "Workflow stopped", output: `Stopped: ${job.title}`, metadata: { status: job.status } }
        case "save": {
          const name = await saveWorkflowAsCommand(job.def, args.commandName ?? job.title, async (filePath, content) => {
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, content, "utf-8")
          })
          return { title: "Workflow saved", output: `Saved as /${name} (.opencode/command/${name}.md).`, metadata: { command: name } }
        }
        default:
          throw new Error(`Unknown action '${args.action}'. Use list | output | pause | resume | stop | save.`)
      }
    },
  })
}

/**
 * One job's view. A FINISHED job shows its real summary. A RUNNING job is
 * deliberately terse — just position + a "don't poll" note — so checking it is
 * never a reason to busy-poll: the session is notified automatically on
 * completion. (Per-job position/counts are also in `/workflows`.)
 */
export function renderProgress(job: WorkflowJob): string {
  if (job.result) return job.result // finished — show the real summary
  const p = job.progress
  const done = p.agents.filter((a) => a.status === "completed").length
  const running = p.agents.filter((a) => a.status === "running").length
  return (
    `⏳ Workflow ${job.id} "${job.title}" is running — stage ${p.stageIndex + 1}/${p.totalStages}, ` +
    `${done} agent(s) done, ${running} running.\n` +
    `It will notify this conversation with the result automatically when it finishes — do NOT poll.`
  )
}

export function formatWorkflowList(state: UltraState): string {
  const lines: string[] = []
  const active = [...state.workflows.jobs.values()]
  if (active.length > 0) {
    lines.push("Active Workflows:")
    for (const job of active) {
      lines.push(`  ${job.id}  "${job.title}"  ${job.status}  (stage ${job.progress.stageIndex + 1}/${job.progress.totalStages}, ${runningCount(job)} running)`)
    }
    lines.push("")
  }
  const completed = state.workflows.completedJobs
  if (completed.length > 0) {
    lines.push("Completed:")
    for (const job of completed.slice(-5)) lines.push(`  ${job.id}  "${job.title}"  ${job.status}`)
    lines.push("")
  }
  if (active.length === 0 && completed.length === 0) lines.push("No workflows found.")
  if (active.length > 0) lines.push("Running workflows notify the conversation automatically on completion — no need to poll.")
  return lines.join("\n")
}

function runningCount(job: WorkflowJob): number {
  return job.progress.agents.filter((a) => a.status === "running").length
}
