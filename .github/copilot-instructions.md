# Automated Documentation Sync - Copilot Instructions

## Project Purpose

This project implements an Agentic SDLC pipeline for automated documentation
synchronization using GitHub Copilot.

The SDLC workflow is coordinated by `.github/agents/orchestration-agent.agent.md`:

1. Requirements Agent produces traceable requirements; human approval is required.
2. Architecture Agent documents the approved solution; human approval is required.
3. Design Review Agent records risks and recommendations; required design changes need human approval.
4. Implementation Planning Agent creates a dependency-ordered plan; human approval is required.
5. Implementation Agent completes only approved, unblocked plan tasks.
6. Code Review Agent performs a read-only review; findings must be resolved or explicitly accepted by a human.
7. Verification Agent runs software and documentation checks and reports actual evidence.
8. Pull Request Agent prepares PR material only after review and verification; PR creation requires an explicit user request.

Use `.github/agents/*.agent.md` for role-based work and the matching `.github/skills/<role>/SKILL.md` for detailed procedures. Do not add or rely on `.github/prompts/*.prompt.md` for this workflow. `.github/hooks/workflow-hooks.json` injects the workflow reminder at session start; hooks do not replace human approval.

## General Rules

- Always inspect existing files before creating new files.
- Do not invent requirements that are not present in the source material.
- If information is missing, explicitly mark it as "Not Found".
- Ask clarification questions when requirements are ambiguous.
- Do not silently make assumptions about business requirements.
- Keep generated documentation consistent across all SDLC artifacts.
- Prefer small, reviewable changes.
- Do not expose secrets, credentials, tokens, API keys, or personal information.
- Validate user input and external data.
- Follow existing project coding conventions.
- Reuse existing utilities instead of duplicating logic.

## Human-in-the-Loop Rule

Copilot may analyze, recommend, generate and modify files.

However:

- Architecture decisions require human approval.
- Design review findings require human approval.
- Implementation plans require human approval.
- Production code changes require human review.
- Pull requests must not be considered approved automatically.
- The orchestrator must pause at the human approval gates above and must not imply that a reviewer or verification run approved publication.

## Documentation Artifacts

The following repository-root files are authoritative:

- `requirements.md`
- `architecture.md`
- `design-review.md`
- `impl-plan.md`

Files with the same names under `.github/` are not authoritative; update the repository-root artifacts unless a human explicitly changes this rule.

Changes to implementation must remain consistent with these documents.

## Missing Information

When required information cannot be determined from the available
source material, write:

"Not Found"

Do not fabricate values.

## Testing

Every implementation must include appropriate tests.

Tests should cover:

- Happy path
- Missing input
- Invalid input
- Not Found cases
- External/API failures
- Empty repository or missing files where applicable

## Code Quality

Review for:

- Correctness
- Security
- Error handling
- Test coverage
- Code clarity
- DRY principle
- Dependency safety

## Documentation Sync

When implementation changes behavior described in requirements.md,
architecture.md, or other documentation, identify the inconsistency and
recommend or perform the appropriate documentation update.