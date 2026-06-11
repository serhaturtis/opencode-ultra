import { describe, it, expect } from "vitest"
import { compileRules } from "../../src/auto-mode/rule-compiler"
import { DEFAULT_AUTO_MODE_CONFIG } from "../../src/config"
import { classify } from "../../src/auto-mode/stage1"
import type { AutoModeConfig, Stage1Rule } from "../../src/contracts"

const cfg = (over: Partial<AutoModeConfig> = {}): AutoModeConfig => ({ ...DEFAULT_AUTO_MODE_CONFIG, ...over })
const bash = (rules: readonly Stage1Rule[], command: string) => classify("bash", { command }, rules)

describe("compileRules: Stage 2 prompt", () => {
  it("includes hard, soft, and environment prose under labelled sections", () => {
    const { stage2PromptText } = compileRules(cfg({
      hardDeny: ["Never nuke prod"],
      softDeny: ["Ask before migrations"],
      environment: ["AWS us-east-1"],
    }))
    expect(stage2PromptText).toContain("HARD RULES")
    expect(stage2PromptText).toContain("Never nuke prod")
    expect(stage2PromptText).toContain("SOFT RULES")
    expect(stage2PromptText).toContain("Ask before migrations")
    expect(stage2PromptText).toContain("AWS us-east-1")
  })
})

describe("compileRules: prose → Stage 1 (deterministic enforcement)", () => {
  it("compiles a protected-branch hard rule to an order-independent force-push DENY", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: ["Never push to the release branch"] }))
    expect(bash(stage1Rules, "git push origin release --force")).toBe("DENY")
    expect(bash(stage1Rules, "git push --force origin release")).toBe("DENY")
    expect(bash(stage1Rules, "git push origin release")).toBe("FLAGGED") // normal push escalates, not denied
  })

  it("default rules deterministically DENY force-push to main/master only", () => {
    const { stage1Rules } = compileRules(DEFAULT_AUTO_MODE_CONFIG)
    expect(bash(stage1Rules, "git push --force origin main")).toBe("DENY")
    expect(bash(stage1Rules, "git push origin master --force")).toBe("DENY")
    expect(bash(stage1Rules, "git push --force origin feature/x")).toBe("FLAGGED") // unprotected branch
  })

  it("a protected-path hard rule DENIES writes to .env but ALLOWS .env.example", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: ["Never modify .env files"] }))
    expect(classify("write", { filePath: "config/.env", content: "X=1" }, stage1Rules)).toBe("DENY")
    // .env.example is the safe template — a routine write, not protected.
    expect(classify("write", { filePath: ".env.example", content: "X=1" }, stage1Rules)).toBe("ALLOW")
  })

  it("a protected-path rule does NOT catch lookalike filenames (they're routine writes)", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: ["Never modify .env files"] }))
    // `.env` must be a path segment, not a suffix of another filename.
    expect(classify("write", { filePath: "my.env", content: "X=1" }, stage1Rules)).toBe("ALLOW")
    expect(classify("write", { filePath: "secret.env", content: "X=1" }, stage1Rules)).toBe("ALLOW")
  })

  it("still protects .git when the prose also mentions .gitignore", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: ["Never modify .git and .gitignore"] }))
    // The .git protection must NOT be suppressed by the .gitignore mention.
    expect(classify("write", { filePath: ".git/config", content: "x" }, stage1Rules)).toBe("DENY")
    // ...while .gitignore itself is not the .git dir → a routine write.
    expect(classify("write", { filePath: ".gitignore", content: "x" }, stage1Rules)).toBe("ALLOW")
  })

  it("the .git directory rule matches the dir/contents but not sibling files", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: ["Never modify the .git directory"] }))
    const w = (p: string) => classify("write", { filePath: p, content: "x" }, stage1Rules)
    expect(w(".git/config")).toBe("DENY")
    expect(w("src/.git/HEAD")).toBe("DENY")
    // Sibling/lookalike files are NOT the .git directory → routine writes:
    for (const f of [".gitignore", ".gitattributes", ".gitconfig", ".git-credentials"]) {
      expect(w(f), f).toBe("ALLOW")
    }
  })

  it("a soft protected-path rule only escalates (FLAGGED), never DENIES", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: [], softDeny: ["Ask before modifying .ssh keys"] }))
    expect(classify("write", { filePath: "/home/u/.ssh/config", content: "x" }, stage1Rules)).toBe("FLAGGED")
  })

  it("does not over-compile vague rules (they remain Stage 2 only)", () => {
    const { stage1Rules } = compileRules(cfg({ hardDeny: ["Be careful with stuff"] }))
    expect(bash(stage1Rules, "deploy-prod.sh")).toBe("FLAGGED") // no spurious DENY pattern produced
  })
})
