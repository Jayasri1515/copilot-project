---
name: start-sdlc
description: Start or resume the gated SDLC through its single Orchestrator entry point.
agent: sdlc-orchestrator
argument-hint: Project idea, clarification answer, artifact approval, or release-action approval.
---

Run the SDLC Orchestrator. Read the shared repository instructions, `.github/sdlc-status.md`, `.github/input/userstory.md`, and existing artifacts. Resume from the earliest incomplete stage. Do not regenerate approved work or pass a pending human approval gate.

If I provide a project idea or answer a clarification, use it to update the current Stage 1 work. If I approve an artifact, proceed only to the next permitted stage. If I reject it, revise that artifact and resubmit it. Treat approvals for commit, push, remote PR creation, and merge as separate actions.

This prompt file is supported by the VS Code Local harness. In other harnesses, select the `sdlc-orchestrator` custom agent directly; the agent definitions remain the primary workflow configuration.
