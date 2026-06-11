/**
 * chat.params hook — sets maximum reasoning effort when ultracode is active.
 *
 * The hook output has no "variant" field. Provider-specific options
 * are set directly in output.options, which flows through
 * ProviderTransform.providerOptions() to the AI SDK.
 */
export function setMaxThinkingEffort(
  model: { providerID?: string; id: string },
  output: { options: Record<string, unknown> },
): void {
  const providerId = model.providerID ?? ""
  const modelId = model.id.toLowerCase()

  if (providerId === "anthropic" || modelId.includes("claude")) {
    output.options["thinking"] = { type: "enabled", budgetTokens: 31_999 }
    return
  }

  if (providerId === "openai" || modelId.includes("gpt")) {
    output.options["reasoningEffort"] = "xhigh"
    return
  }

  if (providerId === "google" || modelId.includes("gemini")) {
    output.options["thinkingConfig"] = { includeThoughts: true, thinkingBudget: 32_768 }
    return
  }
}
