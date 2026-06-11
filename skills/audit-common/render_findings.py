#!/usr/bin/env python3
"""Render audit findings JSON into the canonical report markdown.

Deterministic output: stable IDs (<PREFIX>-<NN>) ordered by severity then
blocking, [ ] tracking checkboxes, full evidence preserved. Keeps report
format independent of whichever model produced the findings.

Input file shape:
    {
      "date": "YYYY-MM-DD",
      "reports": [
        {
          "file": "01-deploy-pipeline",       # output md filename (no ext)
          "prefix": "DEP",                    # finding-ID prefix
          "title": "Scope 3 — Production deploy path",
          "findings": [ {<findings-schema item>}, ... ],
          "summary": "..."                    # optional
        }, ...
      ]
    }

Usage:
    python3 render_findings.py input.json output_dir/
Prints a manifest (ID, severity, blocking, title) to stdout for INDEX
authoring. Exits non-zero on schema-ish problems (missing required keys).
"""
import json
import sys
from pathlib import Path

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
REQUIRED = ("title", "severity", "blocking", "file", "evidence", "rationale", "confidence")


def fail(msg: str) -> None:
    print(f"render_findings: {msg}", file=sys.stderr)
    sys.exit(1)


def render_report(rep: dict, date: str) -> str:
    prefix = rep["prefix"]
    findings = sorted(
        rep["findings"],
        key=lambda f: (SEV_ORDER.get(f["severity"], 9), not f.get("blocking", False)),
    )
    lines = [
        f"# {rep['title']}",
        "",
        f"Part of the {date} audit. See [INDEX.md](INDEX.md) for the triage,",
        "method, and caveats. Status legend: `[ ]` open / `[x]` closed",
        "(record the closing commit SHA beside the checkbox).",
        "",
    ]
    if rep.get("summary"):
        lines += ["## Scope summary", "", rep["summary"], ""]
    manifest = []
    for i, f in enumerate(findings, 1):
        missing = [k for k in REQUIRED if k not in f]
        if missing:
            fail(f"{prefix} finding {i} missing keys: {missing} ({f.get('title','?')[:60]})")
        fid = f"{prefix}-{i:02d}"
        manifest.append((fid, f["severity"], bool(f.get("blocking")), f["title"]))
        blocking = " **BLOCKING**" if f.get("blocking") else ""
        loc = f["file"] + (f":{f['line']}" if f.get("line") else "")
        lines += [
            f"## {fid} — {f['title']}",
            "",
            "- [ ] *(open)*",
            f"- **Severity:** {f['severity']}{blocking} · **Confidence:** {f['confidence']}"
            + (f" · **Also reported by:** {f['also_reported_by']}" if f.get("also_reported_by") else ""),
            f"- **Location:** `{loc}`",
            "",
            f"**Evidence:** {f['evidence']}",
            "",
            f"**Why it matters:** {f['rationale']}",
            "",
        ]
        if f.get("fix_sketch"):
            lines += [f"**Fix sketch:** {f['fix_sketch']}", ""]
    rep["_manifest"] = manifest
    return "\n".join(lines)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: render_findings.py input.json output_dir/")
    data = json.loads(Path(sys.argv[1]).read_text())
    outdir = Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    date = data.get("date", "UNDATED")
    if "reports" not in data:
        fail("input missing 'reports'")
    for rep in data["reports"]:
        for k in ("file", "prefix", "title", "findings"):
            if k not in rep:
                fail(f"report missing '{k}'")
        (outdir / f"{rep['file']}.md").write_text(render_report(rep, date))
    print(f"# manifest ({date})")
    for rep in data["reports"]:
        for fid, sev, blocking, title in rep["_manifest"]:
            print(f"{fid}\t{sev}{'  BLOCKING' if blocking else ''}\t{title[:120]}")


if __name__ == "__main__":
    main()
