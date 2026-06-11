/**
 * RealSdkClient adapter contract — the one module that unwraps SDK responses.
 * Regression: createSession must FAIL FAST on a malformed response rather than
 * silently returning undefined (which violates the Promise<string> contract and
 * propagates `undefined` session ids into callers).
 */
import { describe, it, expect } from "vitest"
import { createRealSdkClient } from "../../src/sdk-real"

const clientWithCreate = (createRes: unknown) => ({
  session: { create: async () => createRes, prompt: async () => ({}), delete: async () => ({}) },
  app: { agents: async () => ({ data: [] }) },
}) as never

describe("createRealSdkClient.createSession", () => {
  it("returns the id from a { data: { id } } response", async () => {
    const sdk = createRealSdkClient(clientWithCreate({ data: { id: "ses_1" } }))
    expect(await sdk.createSession("", "t")).toBe("ses_1")
  })

  it("returns the id from a direct { id } payload (throwOnError:true shape)", async () => {
    const sdk = createRealSdkClient(clientWithCreate({ id: "ses_2" }))
    expect(await sdk.createSession("", "t")).toBe("ses_2")
  })

  it("throws (fail fast) when the response carries no id", async () => {
    const sdk = createRealSdkClient(clientWithCreate({ data: {} }))
    await expect(sdk.createSession("", "t")).rejects.toThrow(/no session id/i)
  })
})
