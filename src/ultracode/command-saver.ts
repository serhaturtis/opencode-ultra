/**
 * Command saver — persists a workflow definition as a reusable slash command in
 * .opencode/command/<name>.md. The saved command can be invoked as /<name> in
 * future sessions.
 */
import type { WorkflowDef } from "../contracts.js"
import { slugify } from "../util.js"

/** Save a workflow as a reusable slash command. Returns the command name. */
export async function saveWorkflowAsCommand(
  def: WorkflowDef,
  commandName: string,
  writeFile: (path: string, content: string) => Promise<void>,
): Promise<string> {
  const name = slugify(commandName || def.title, 50, "workflow")
  const filePath = `.opencode/command/${name}.md`
  await writeFile(filePath, buildCommandMarkdown(name, def))
  return name
}

function buildCommandMarkdown(name: string, def: WorkflowDef): string {
  return [
    "---",
    `description: ${escapeYaml(def.title || name)}`,
    "---",
    "",
    `# /${name}`,
    "",
    def.title || name,
    "",
    "```json workflow",
    JSON.stringify(def, null, 2),
    "```",
  ].join("\n")
}

function escapeYaml(text: string): string {
  return /[:"']/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}
