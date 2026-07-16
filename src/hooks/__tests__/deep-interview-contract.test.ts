import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const deepInterviewSkill = readFileSync(
	join(__dirname, "../../../skills/deep-interview/SKILL.md"),
	"utf-8",
);
const pluginDeepInterviewSkill = readFileSync(
	join(__dirname, "../../../plugins/nomx/skills/deep-interview/SKILL.md"),
	"utf-8",
);
const autopilotSkill = readFileSync(
	join(__dirname, "../../../skills/autopilot/SKILL.md"),
	"utf-8",
);
const templateAgents = readFileSync(
	join(__dirname, "../../../templates/AGENTS.md"),
	"utf-8",
);
describe("deep-interview Ouroboros contract", () => {
	it("includes ambiguity gate math and intent-first scoring", () => {
		assert.match(deepInterviewSkill, /ambiguity/i);
		assert.match(deepInterviewSkill, /threshold/i);
		assert.match(deepInterviewSkill, /Greenfield: `ambiguity =/);
		assert.match(deepInterviewSkill, /Brownfield: `ambiguity =/);
		assert.match(deepInterviewSkill, /intent × 0\.30/i);
		assert.match(deepInterviewSkill, /Decision Boundaries/i);
	});

	it("adds intent-first concepts and readiness gates", () => {
		assert.match(deepInterviewSkill, /Intent \(why the user wants this\)/i);
		assert.match(deepInterviewSkill, /Desired Outcome/i);
		assert.match(deepInterviewSkill, /Out-of-Scope \/ Non-goals/i);
		assert.match(deepInterviewSkill, /Decision Boundaries/i);
		assert.match(deepInterviewSkill, /Reduce user effort/i);
		assert.match(deepInterviewSkill, /must be explicit/i);
		assert.match(deepInterviewSkill, /pressure pass/i);
	});

	it("prioritizes intent-boundary questioning before implementation detail", () => {
		const intentFirstIndex = deepInterviewSkill.indexOf(
			"Ask about intent and boundaries before implementation detail",
		);
		const weakDimIndex = deepInterviewSkill.indexOf(
			"Target the lowest-scoring dimension, but respect stage priority",
		);
		const artifactIndex = deepInterviewSkill.indexOf("Spec should include:");

		assert.notEqual(intentFirstIndex, -1);
		assert.notEqual(weakDimIndex, -1);
		assert.notEqual(artifactIndex, -1);
		assert.ok(intentFirstIndex < artifactIndex);
		assert.ok(weakDimIndex < artifactIndex);
	});
	it("includes challenge mode structure", () => {
		assert.match(deepInterviewSkill, /Contrarian/i);
		assert.match(deepInterviewSkill, /Simplifier/i);
		assert.match(deepInterviewSkill, /Ontologist/i);
	});

	it("strengthens questioning pressure on all four analysis axes", () => {
		assert.match(
			deepInterviewSkill,
			/Treat every answer as a claim to pressure-test before moving on/i,
		);
		assert.match(
			deepInterviewSkill,
			/demand evidence or examples, expose a hidden assumption, force a tradeoff or boundary, or reframe root cause vs symptom/i,
		);
		assert.match(
			deepInterviewSkill,
			/Do not rotate to a new clarity dimension just for coverage/i,
		);
		assert.match(
			deepInterviewSkill,
			/Prefer staying on the same thread for multiple rounds when it has the highest leverage/i,
		);
		assert.match(
			deepInterviewSkill,
			/Do not offer early exit before the first explicit assumption probe and one persistent follow-up have happened/i,
		);
		assert.match(
			deepInterviewSkill,
			/Round 4\+: allow explicit early exit with risk warning/i,
		);
	});

	it("routes facts before judgment", () => {
		assert.match(deepInterviewSkill, /Route facts before judgment/i);
		assert.match(deepInterviewSkill, /\[from-code\]\[auto-confirmed\]/i);
		assert.match(deepInterviewSkill, /\[from-code\]/i);
		assert.match(deepInterviewSkill, /\[from-research\]/i);
		assert.match(deepInterviewSkill, /\[from-user\]/i);
		assert.match(deepInterviewSkill, /transcript\/spec labels only/i);
		assert.match(deepInterviewSkill, /not interview rounds/i);
		assert.match(deepInterviewSkill, /Auto-confirm only descriptive facts/i);
		assert.match(deepInterviewSkill, /decision-bearing question to the user as `\[from-user\]`/i);
	});

	it("prevents continuing ordinary questions after ambiguity falls below threshold", () => {
		assert.match(deepInterviewSkill, /Profile `max rounds` is a hard cap, not a target/i);
		assert.match(deepInterviewSkill, /Do not continue only to reach a numbered round count/i);
		assert.match(deepInterviewSkill, /Extra Socratic rigor does not override the active threshold/i);
		assert.match(deepInterviewSkill, /stop ordinary questioning/i);
		assert.match(deepInterviewSkill, /crystallize\/handoff when readiness gates pass/i);
		assert.match(deepInterviewSkill, /<= 0\.10.*final closure question/i);
		assert.match(autopilotSkill, /not a one-question gate; `max_rounds` is a cap, not a target/i);
		assert.match(autopilotSkill, /Ask another question only when a readiness gate is still unresolved/i);
	});

	it("adds Ouroboros-style rhythm, breadth, and practical closure guards", () => {
		assert.match(deepInterviewSkill, /Breadth Ledger/i);
		assert.match(deepInterviewSkill, /scope, constraints, outputs, verification, brownfield integration/i);
		assert.match(deepInterviewSkill, /guard, not a mandatory rotation rule/i);
		assert.match(deepInterviewSkill, /zoom out only when another material track remains unresolved/i);
		assert.match(deepInterviewSkill, /practical closure audit/i);
		assert.match(deepInterviewSkill, /another question would change execution materially/i);
		assert.match(deepInterviewSkill, /not merely polish wording or chase a narrow edge case/i);
		assert.match(deepInterviewSkill, /low ambiguity score as permission to audit closure/i);
		assert.match(deepInterviewSkill, /Dialectic Rhythm Guard/i);
		assert.match(deepInterviewSkill, /After 3 consecutive non-user or confirmation answers/i);
		assert.match(deepInterviewSkill, /must solicit direct human judgment/i);
	});

	it("grounds brownfield interviews in repo docs, terminology, and scenarios", () => {
		assert.match(
			deepInterviewSkill,
			/doc\/context grounding before user-facing questions/i,
		);
		assert.match(deepInterviewSkill, /applicable `AGENTS\.md` files/i);
		assert.match(deepInterviewSkill, /README\/getting-started docs/i);
		assert.match(deepInterviewSkill, /docs\/.*contracts\/plans\/ADRs/i);
		assert.match(deepInterviewSkill, /`CONTEXT\.md` or `CONTEXT-MAP\.md`/i);
		assert.match(deepInterviewSkill, /Docs\/Terminology Ledger/i);
		assert.match(deepInterviewSkill, /canonical terms already used by the repo/i);
		assert.match(deepInterviewSkill, /user terms that conflict with docs or current code behavior/i);
		assert.match(
			deepInterviewSkill,
			/Cross-check user claims about current behavior against code or documented contracts/i,
		);
		assert.match(
			deepInterviewSkill,
			/If docs and code disagree, ask a confirmation question that names both sources/i,
		);
		assert.match(deepInterviewSkill, /Terminologist/i);
		assert.match(
			deepInterviewSkill,
			/Stress-test the boundary with one concrete scenario or edge case/i,
		);
	});

	it("keeps durable documentation updates opt-in and preserves grounding for ultragoal handoff", () => {
		assert.match(
			deepInterviewSkill,
			/Durable docs, glossary, ADR, or memory updates are opt-in and public-safe only/i,
		);
		assert.match(
			deepInterviewSkill,
			/must not automatically create or dump public docs from interview transcripts/i,
		);
		assert.match(
			deepInterviewSkill,
			/Optional durable documentation recommendations, explicitly marked opt-in and public-safe/i,
		);
		assert.match(
			deepInterviewSkill,
			/Read applicable repo docs\/rules\/context during preflight; write durable docs, glossary, ADR, or memory updates only when the user explicitly opts in/i,
		);
		assert.match(
			deepInterviewSkill,
			/preserve intent, non-goals, decision boundaries, acceptance criteria, docs\/terminology grounding/i,
		);
		assert.match(
			deepInterviewSkill,
			/Durable docs\/ADR\/memory updates, if any, were explicitly opted into and public-safe/i,
		);
	});

	it("moves challenge modes and preserved evidence discipline earlier", () => {
		assert.match(
			deepInterviewSkill,
			/Contrarian.*round 2\+.*untested assumption/i,
		);
		assert.match(
			deepInterviewSkill,
			/Simplifier.*round 4\+.*scope expands faster than outcome clarity/i,
		);
		assert.match(
			deepInterviewSkill,
			/Ontologist.*round 5\+.*ambiguity > 0\.25.*describing symptoms/i,
		);
		assert.match(
			deepInterviewSkill,
			/Brownfield evidence vs inference notes/i,
		);
	});

	it("includes contract-style execution bridge and no-direct-implementation guard", () => {
		assert.match(deepInterviewSkill, /Execution Bridge/i);
		assert.match(deepInterviewSkill, /\$ultragoal/i);
		assert.match(deepInterviewSkill, /\$ralplan/i);
		assert.match(deepInterviewSkill, /\$autopilot/i);
		assert.match(deepInterviewSkill, /\$ralph/i);
		assert.match(deepInterviewSkill, /Input Artifact/i);
		assert.match(deepInterviewSkill, /Invocation/i);
		assert.match(deepInterviewSkill, /Consumer Behavior/i);
		assert.match(deepInterviewSkill, /Skipped \/ Already-Satisfied Stages/i);
		assert.match(deepInterviewSkill, /Expected Output/i);
		assert.match(deepInterviewSkill, /Best When/i);
		assert.match(deepInterviewSkill, /Next Recommended Step/i);
		assert.match(deepInterviewSkill, /Residual-Risk Rule/i);
		assert.match(deepInterviewSkill, /Do NOT implement directly/i);
	});

	it("documents optional execution contract foundation for Autopilot stride handoff", () => {
		assert.match(deepInterviewSkill, /Optional execution contract foundation/i);
		assert.match(deepInterviewSkill, /execution_contract_required/i);
		assert.match(deepInterviewSkill, /execution_contract/i);
		assert.match(deepInterviewSkill, /execution_stride/i);
		assert.match(deepInterviewSkill, /task.*deliverable.*milestone/s);
		assert.match(deepInterviewSkill, /allow_task_shrink/i);
		assert.match(deepInterviewSkill, /completion_unit/i);
		assert.match(deepInterviewSkill, /stop_condition/i);
		assert.match(deepInterviewSkill, /acceptance_coverage_scope/i);
		assert.match(deepInterviewSkill, /shrink_policy/i);
		assert.match(deepInterviewSkill, /do not infer stride from task length, phase labels, snapshots, or freeform wording/i);
		assert.match(deepInterviewSkill, /New artifacts must write the canonical snake_case schema/i);
		assert.match(deepInterviewSkill, /runtime readers may accept legacy camelCase field\/marker aliases and direct\/nested `execution_contract` locations only as compatibility input/i);
		assert.match(pluginDeepInterviewSkill, /Optional execution contract foundation/i);
	});

	it("preserves clarified intent and boundary constraints across execution handoff", () => {
		assert.match(
			deepInterviewSkill,
			/preserve intent, non-goals, decision boundaries, acceptance criteria/i,
		);
		assert.match(deepInterviewSkill, /binding context/i);
	});

	it("uses NOMX-native output paths", () => {
		assert.match(deepInterviewSkill, /\.nomx\/interviews\//);
		assert.match(deepInterviewSkill, /\.nomx\/specs\//);
	});

	it("requires prompt-safe summary gating for oversized initial context", () => {
		assert.match(deepInterviewSkill, /prompt-safe initial-context summary/i);
		assert.match(deepInterviewSkill, /oversized initial context/i);
		assert.match(deepInterviewSkill, /do not paste or forward the raw payload/i);
		assert.match(deepInterviewSkill, /wait for the concise summary before ambiguity scoring, crystallizing artifacts, or any downstream execution handoff/i);
		assert.match(deepInterviewSkill, /The oversized initial-context summary gate is blocking/i);
		assert.match(deepInterviewSkill, /goals, constraints, success criteria, non-goals, decision boundaries/i);
	});

	it("documents total prompt-budget hardening for retained context", () => {
		assert.match(deepInterviewSkill, /Keep total prompt payloads within a safe budget/i);
		assert.match(deepInterviewSkill, /summarizing or trimming retained history/i);
		assert.match(deepInterviewSkill, /preserve newest\/highest-signal answers/i);
		assert.match(deepInterviewSkill, /Prompt-safe initial-context summary when oversized context was provided/i);
		assert.match(deepInterviewSkill, /summary gate is not needed, pending, or satisfied/i);
		assert.match(deepInterviewSkill, /before any scoring or handoff step/i);
	});

	it("requires preflight context intake before interview rounds", () => {
		assert.match(deepInterviewSkill, /Phase 0: Preflight Context Intake/i);
		assert.match(
			deepInterviewSkill,
			/preflight context intake before the first interview question/i,
		);
		assert.match(
			deepInterviewSkill,
			/\.nomx\/context\/\{slug\}-\{timestamp\}\.md/,
		);
		assert.match(deepInterviewSkill, /context_snapshot_path/i);
	});

});

describe("cross-skill and AGENTS coherence for deep-interview", () => {
	it("autopilot references deep-interview handoff", () => {
		assert.match(autopilotSkill, /deep-interview/i);
		assert.match(autopilotSkill, /Socratic/i);
	});

	it("plugin mirror keeps the deep-interview skill aligned", () => {
		assert.equal(pluginDeepInterviewSkill, deepInterviewSkill);
	});

	it("canonical AGENTS template includes ouroboros keyword and updated description", () => {
		assert.match(templateAgents, /ouroboros/i);
		assert.match(templateAgents, /Socratic requirements clarification/i);
	});

});
