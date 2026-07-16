---
name: ralph
description: Self-referential loop until task completion with architect verification
---

[RALPH + ULTRAWORK - ITERATION {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

<Purpose>
Ralph is a persistence loop that keeps working on a task until it is fully complete and architect-verified. It wraps ultrawork's parallel execution with session persistence, automatic retry on failure, and mandatory verification before completion.
</Purpose>

<Use_When>
- Task requires guaranteed completion with verification (not just "do your best")
- User says "ralph", "don't stop", "must complete", "finish this", or "keep going until done"
- Work may span multiple iterations and needs persistence across retries
- Task benefits from parallel execution with architect sign-off at the end
</Use_When>

<Do_Not_Use_When>
- User wants a full autonomous pipeline from idea to code -- use `autopilot` instead
- User wants to explore or plan before committing -- use `plan` skill instead
- User wants a quick one-shot fix -- delegate directly to an executor agent
- User wants manual control over completion -- use `ultrawork` directly
</Do_Not_Use_When>

<Why_This_Exists>
Complex tasks often fail silently: partial implementations get declared "done", tests get skipped, edge cases get forgotten. Ralph prevents this by looping until work is genuinely complete, requiring fresh verification evidence before allowing completion, and using explicit architect native-subagent verification to confirm quality.
</Why_This_Exists>

<Execution_Policy>
- Fire independent agent calls simultaneously -- never wait sequentially for independent work
- Use the native `spawn_agent` contract that is actually available: a bounded `task_name`, a precise `message`, and `fork_turns` only when controlling inherited context materially helps. Do not invent dispatch fields.
- Native subagents inherit the current repository and session defaults. When explicit role routing is unavailable and a pass requires a NOMX role, use `CODEX_THREAD_ID` as the authenticated current leader identity and run `nomx ralplan role-intent write --role <role> --parent-thread "$CODEX_THREAD_ID" --json`, then use the receipt's `spawn_task_name` as the exact `task_name`. The validated ledger receipt carries role identity; `message` carries only the bounded work, evidence requirements, and output contract. Never replace the receipt with a prompt role label.
- Preserve legacy Ralph tier intent through task scope and message detail: LOW for a narrow lookup, STANDARD for bounded implementation, and THOROUGH for complex or high-risk analysis.
- For long operations (installs, builds, test suites), use the command runner's yielded process session and poll it while independent native subagents continue their lanes.
- Deliver the full implementation: no scope reduction, no partial completion, no deleting tests to make them pass
- Apply the shared workflow guidance pattern: outcome-first framing, concise visible updates for multi-step execution, local overrides for the active workflow branch, validation proportional to risk, explicit stop rules, and automatic continuation for safe reversible steps. Ask only for material, destructive, credentialed, external-production, or preference-dependent branches.
- Integrate with Codex goal mode when goal tools are available: inspect the active thread goal with `get_goal`, preserve it as the top-level stop condition, and only call `update_goal({status: "complete"})` after a Ralph completion audit proves the objective is actually achieved.
</Execution_Policy>

<Steps>
0. **Pre-context intake (required before planning/execution loop starts)**:
   - Assemble or load a context snapshot at `.nomx/context/{task-slug}-{timestamp}.md` (UTC `YYYYMMDDTHHMMSSZ`).
   - Minimum snapshot fields:
     - task statement
     - desired outcome
     - known facts/evidence
     - constraints
     - unknowns/open questions
     - likely codebase touchpoints
   - If an existing relevant snapshot is available, reuse it and record the path in Ralph state.
   - If request ambiguity is high, gather brownfield facts first. `nomx explore` is deprecated; use normal repository inspection tools/subagents for simple read-only repository lookups and `nomx sparkshell` only for explicit shell-native read-only evidence. Then run `$deep-interview --quick <task>` to close critical gaps.
   - Do not begin Ralph execution work (delegation, implementation, or verification loops) until snapshot grounding exists. If forced to proceed quickly, note explicit risk tradeoffs.
1. **Review progress**: Check TODO list and any prior iteration state
2. **Continue from where you left off**: Pick up incomplete tasks
3. **Delegate in parallel**: Route independent tasks through native `spawn_agent` calls using only `task_name`, `message`, and optional `fork_turns`
   - Simple lookup message: "Inspect the named function and return its behavior with file:line evidence."
   - Standard work message: "Implement the bounded error-handling change, run targeted tests, and report changed files plus evidence."
   - Complex analysis message: "Investigate the race condition; return root cause, evidence, and the smallest safe fix."
   - For every role-specific lane on an adapted App surface, record validated role intent first and use the receipt's exact `spawn_task_name`; do not improvise a descriptive task name or role prompt.
   - When Ralph is entered as a ralplan follow-up, preserve the approved implementation, evidence/regression, and final sign-off role assignments through their role-intent receipts, and keep each child message bounded to its assigned work.
4. **Run long operations through yielded command sessions**: Start builds, installs, and test suites with the command runner; poll the returned session without blocking independent agent lanes.
5. **Visual task gate (when screenshot/reference images are present)**:
   - Run the Visual Ralph verdict step **before every next edit**.
   - Require structured JSON output: `score`, `verdict`, `category_match`, `differences[]`, `suggestions[]`, `reasoning`.
   - Persist verdict to `.nomx/state/{scope}/ralph-progress.json` including numeric + qualitative feedback.
   - Default pass threshold: `score >= 90`.
   - **URL-based visual tasks**: inspect the live target, capture visual evidence, and use the `designer` and `vision` agent roles directly when available.
6. **Verify completion with fresh evidence**:
   - If Codex goal mode is available, call `get_goal` before final verification to restate the active objective and include it in the evidence checklist.
   a. Identify what command proves the task is complete
   b. Run verification (test, build, lint)
   c. Read the output -- confirm it actually passed
   d. Check: zero pending/in_progress TODO items
7. **Architect verification** (native role):
   - Before every adapted App verification spawn, run `nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json` and read `spawn_task_name` from the validated receipt.
   - <5 files, <100 lines with full tests: `spawn_agent({task_name: "<receipt.spawn_task_name>", message: "Independently verify the change's architecture against the task, diff, and fresh test evidence; return APPROVED or blockers."})` minimum
   - Standard changes: use the same receipt-backed call shape with the full task, diff scope, constraints, and verification evidence in `message`
   - >20 files or security/architectural changes: expand the bounded work message with explicit boundary, threat, tradeoff, and regression checks
   - Ralph floor: always run an independent architecture-verification subagent, even for small changes
   - The validated role-intent receipt and correlation token are the authoritative role carrier. Never substitute a descriptive `task_name`, fake the role through `message`, or fabricate extra dispatch fields.
7.5 **Regression Re-verification**:
   - Re-run all required tests/build/lint after final fixes and read the output to confirm they still pass.
   - Do not proceed to completion until the final verification is green.
8. **On approval**: If Codex goal mode is active, call `update_goal({status: "complete"})` before `/cancel`; report final elapsed time and token-budget usage when the tool returns it. Then run `/cancel` to cleanly exit and clean up all state files.
9. **On rejection**: Fix the issues raised, then re-verify with the same architecture-verification task scope and evidence contract
</Steps>

<Tool_Usage>
- Use `ask_codex` with `agent_role: "architect"` for verification cross-checks when changes are security-sensitive, architectural, or involve complex multi-system integration
- Skip Codex consultation for simple feature additions, well-tested changes, or time-critical verification
- If MCP compatibility tools are unavailable, proceed with CLI/agent verification alone -- never block on external tools
- Use `nomx state write/read --input '<json>' --json` for ralph mode state persistence between iterations
- Use Codex goal tools when present: `get_goal` to discover or re-check the active objective, `create_goal` only when the user/system explicitly requested a new goal and no active goal exists, and `update_goal` only after the audited objective is fully achieved.
- Persist context snapshot path in Ralph mode state so later phases and agents share the same grounding context
- Prefer CLI state commands. If an explicit MCP compatibility `nomx_state` call reports that its stdio transport is unavailable/closed, do **not** retry the same MCP call. Retry once through the supported CLI parity surface with the same payload, preserving `workingDirectory` and `session_id`: `nomx state write --input '<json>' --json`, `nomx state read --input '<json>' --json`, or `nomx state clear --input '<json>' --json`. If the CLI path also fails, continue with `.nomx/context` / `.nomx/plans` file-backed artifacts and report the state persistence blocker.
</Tool_Usage>

## Goal Mode Integration

Codex goal mode is the thread-level completion contract for long-running Ralph work. Ralph state tracks workflow mechanics; goal mode tracks whether the user objective is truly done. When the goal tools are available:

1. Call `get_goal` during intake or before the first execution loop when the prompt/hook says an active thread goal exists.
2. If no goal exists, call `create_goal` only when the user or system explicitly asked for goal tracking; otherwise continue with Ralph state alone.
3. Treat `goal.objective` as binding acceptance scope. Newer user updates can refine the current branch, but do not silently narrow the goal.
4. Before completion, perform a prompt-to-artifact checklist and completion audit against real evidence:
   - restate the objective as deliverables/success criteria
   - map every prompt requirement, named workflow (`$ralplan`, `$ralph`), file, command, test, gate, and deliverable to evidence
   - inspect the actual files, command output, state, and tests behind each checklist item
   - identify missing, weakly verified, or uncovered requirements and continue if any remain
5. Call `update_goal({status: "complete"})` only when the audit shows no required work remains. Do not use passing tests, Ralph state, or architect approval as proxy proof unless they cover the whole goal.
6. If goal tools are unavailable, keep working through Ralph state and mention the missing goal-mode evidence in the final report.

## State Management

Use the CLI-first state surface for Ralph lifecycle state (`nomx state write/read/clear --input '<json>' --json`). Explicit MCP compatibility tools (`state_write`, `state_read`, `state_clear`) remain acceptable only when already enabled.

- **On start**:
  `nomx state write --input '{"mode":"ralph","active":true,"iteration":1,"max_iterations":10,"current_phase":"executing","started_at":"<now>","state":{"context_snapshot_path":"<snapshot-path>"}}' --json`
- **On each iteration**:
  `nomx state write --input '{"mode":"ralph","iteration":<current>,"current_phase":"executing"}' --json`
- **On verification/fix transition**:
  `nomx state write --input '{"mode":"ralph","current_phase":"verifying"}' --json` or `nomx state write --input '{"mode":"ralph","current_phase":"fixing"}' --json`
- **On completion** (only after the completion audit passes with real evidence):
  `nomx state write --input '{"mode":"ralph","active":false,"current_phase":"complete","completed_at":"<now>","completion_audit":{"passed":true,"prompt_to_artifact_checklist":["<requirement mapped to artifact/evidence>"],"verification_evidence":["<fresh test/build/lint command and result>"]}}' --json`
- **Before the final answer**:
  1. Run fresh verification and read the output.
  2. Build `prompt_to_artifact_checklist` entries that map every user requirement, workflow gate, named file, command, PR/delivery requirement, and stop condition to a concrete artifact or evidence item.
  3. Build `verification_evidence` entries with concrete commands, exit status, files inspected, PR URLs, or other machine-checkable evidence.
  4. Write the Ralph completion state with a top-level `completion_audit` field on the Ralph state object. Do not write bare top-level `prompt_to_artifact_checklist` or `verification_evidence` fields by themselves; the Stop gate will reject them.
  5. Read the state back with `nomx state read --input '{"mode":"ralph"}' --json` and verify `completion_audit.passed === true`, a non-empty checklist, and non-empty verification evidence before producing the final answer.
  6. If Codex goal mode is active, call `update_goal({status:"complete"})` only after this Ralph audit read-back succeeds.
- **On cancellation/cleanup**:
  run `nomx cancel` (which clears the active Ralph state)


## Scenario Examples

**Good:** The user says `continue` after the workflow already has a clear next step. Continue the current branch of work instead of restarting or re-asking the same question.

**Good:** The user changes only the output shape or downstream delivery step (for example `make a PR`). Preserve earlier non-conflicting workflow constraints and apply the update locally.

**Bad:** The user says `continue`, and the workflow restarts discovery or stops before the missing verification/evidence is gathered.

<Examples>
<Good>
Correct parallel delegation:
```
spawn_agent({task_name: "user_config_export", message: "Add the UserConfig type export, run the narrow type check, and report the changed file plus evidence."})
spawn_agent({task_name: "api_cache_layer", message: "Implement the API response caching layer, run targeted tests, and report changed files plus evidence."})
spawn_agent({task_name: "oauth_refactor", message: "Refactor the auth module to support OAuth2; preserve existing behavior, run relevant tests, and report risks."})
```
Why good: Three independent tasks are started before waiting, each uses only supported native fields, and each message carries its scope, intent, and evidence contract.
</Good>

<Good>
Correct verification before completion:
```
1. Run: npm test           → Output: "42 passed, 0 failed"
2. Run: npm run build      → Output: "Build succeeded"
3. Run: lsp_diagnostics    → Output: 0 errors
4. Run `nomx ralplan role-intent write --role architect --parent-thread "$CODEX_THREAD_ID" --json` and read `spawn_task_name`
5. spawn_agent({task_name: "<receipt.spawn_task_name>", message: "Independently verify completion against the task, diff, and fresh test evidence; return APPROVED or blockers."}) → Verdict: "APPROVED"
6. Run /cancel
```
Why good: Fresh evidence at each step, architect verification, then clean exit.
</Good>

<Bad>
Claiming completion without verification:
"All the changes look good, the implementation should work correctly. Task complete."
Why bad: Uses "should" and "look good" -- no fresh test/build output, no architect verification.
</Bad>

<Bad>
Sequential execution of independent tasks:
```
spawn_agent({task_name: "type_export", message: "Add the type export and report evidence."}) → wait →
spawn_agent({task_name: "cache_layer", message: "Implement caching and report evidence."}) → wait →
spawn_agent({task_name: "auth_refactor", message: "Refactor auth and report evidence."})
```
Why bad: These are independent tasks that should run in parallel, not sequentially.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Stop and report when a fundamental blocker requires user input (missing credentials, unclear requirements, external service down)
- Stop when the user says "stop", "cancel", or "abort" -- run `/cancel`
- Continue working when the hook system sends "The boulder never stops" -- this means the iteration continues
- If architect rejects verification, fix the issues and re-verify (do not stop)
- If the same issue recurs across 3+ iterations, report it as a potential fundamental problem
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] All requirements from the original task are met (no scope reduction)
- [ ] Zero pending or in_progress TODO items
- [ ] Fresh test run output shows all tests pass
- [ ] Fresh build output shows success
- [ ] lsp_diagnostics shows 0 errors on affected files
- [ ] Independent architecture verification passed via `spawn_agent` using the validated architect role-intent receipt's exact `spawn_task_name` and a bounded work/evidence/verdict message
- [ ] Codex goal-mode completion audit passed, and `update_goal({status: "complete"})` was called when an active goal exists
- [ ] Final regression tests pass
- [ ] `nomx cancel` run for clean state cleanup
</Final_Checklist>

<Advanced>
## PRD Mode (Optional)

When the user provides the `--prd` flag, initialize a Product Requirements Document before starting the ralph loop.

### Detecting PRD Mode
Check if `{{PROMPT}}` contains `--prd` or `--PRD`.

Prompt-side `$ralph` workflow activation is lighter-weight than `nomx ralph --prd ...`.
It seeds Ralph workflow state and guidance, but it does not implicitly launch the
CLI entrypoint or apply the PRD startup gate. Treat `nomx ralph --prd ...` as the
explicit PRD-gated path.

### Visual Reference Flags (Optional)
Ralph execution supports visual reference flags for screenshot tasks:
- Repeatable image inputs: `-i <image-path>` (can be used multiple times)
- Image directory input: `--images-dir <directory>`

Example:
`ralph -i refs/hn.png -i refs/hn-item.png --images-dir ./screenshots "match HackerNews layout"`

### PRD Workflow
1. Run deep-interview in quick mode before creating PRD artifacts:
   - Execute: `$deep-interview --quick <task>`
   - Complete a compact requirements pass (context, goals, scope, constraints, validation)
   - Persist interview output to `.nomx/interviews/{slug}-{timestamp}.md`
2. Create canonical PRD/progress artifacts:
   - PRD: `.nomx/plans/prd-{slug}.md`
   - Progress ledger: `.nomx/state/{scope}/ralph-progress.json` (session scope when available, else root scope)
3. Parse the task (everything after `--prd` flag)
4. Break down into user stories:

```json
{
  "project": "[Project Name]",
  "branchName": "ralph/[feature-name]",
  "description": "[Feature description]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Short title]",
      "description": "As a [user], I want to [action] so that [benefit].",
      "acceptanceCriteria": ["Criterion 1", "Typecheck passes"],
      "priority": 1,
      "passes": false
    }
  ]
}
```

5. Initialize canonical progress ledger at `.nomx/state/{scope}/ralph-progress.json`
6. Guidelines: right-sized stories (one session each), verifiable criteria, independent stories, priority order (foundational work first)
7. Proceed to normal ralph loop using user stories as the task list

### Example
User input: `--prd build a todo app with React and TypeScript`
Workflow: Detect flag, extract task, create `.nomx/plans/prd-{slug}.md`, create `.nomx/state/{scope}/ralph-progress.json`, begin ralph loop.

### Legacy compatibility
- During the compatibility window, Ralph `--prd` startup still validates machine-readable story state from `.nomx/prd.json`.
- `.nomx/plans/prd-{slug}.md` remains the canonical storage/documentation artifact, but it is not yet the startup validation source.
- If `.nomx/prd.json` exists and canonical PRD is absent, migrate one-way into `.nomx/plans/prd-{slug}.md`.
- If `.nomx/progress.txt` exists and canonical progress ledger is absent, import one-way into `.nomx/state/{scope}/ralph-progress.json`.
- Keep legacy files unchanged for one release cycle.

## Long-Running Command Rules

**Use yielded command sessions and poll them**:
- Package installation (npm install, pip install, cargo build)
- Build processes (make, project build commands)
- Test suites
- Docker operations (docker build, docker pull)

**Run blocking** (foreground):
- Quick status checks (git status, ls, pwd)
- File reads and edits
- Simple commands
</Advanced>

Original task:
{{PROMPT}}
