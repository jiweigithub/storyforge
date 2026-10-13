import type {
  TtrpgRuntimeState,
} from "../types";
import { parseTtrpgOpenMechanicalStateV1 } from "./runtime-state";
import { key as parseKey } from "./open-contract-parse";
import { parseTtrpgOpenAuthorizationV1, type TtrpgOpenAuthorizationV1 } from "./open-authorization";
import { parseTtrpgOpenCoordinationV1, parseTtrpgOpenEpochBudgetV1,
  type TtrpgOpenCoordinationV1, type TtrpgOpenEpochBudgetV1 } from "./open-coordination";
import { stableProductRuntimeJsonV1 } from "../product/runtime-values";
import { parseTtrpgOpenOperationV1, parseTtrpgOpenRuleReceiptV1,
  type TtrpgOpenOperationV1, type TtrpgOpenRuleReceiptV1 } from "./open-operation";
import type {
  TtrpgOpenCampaignClockV1,
  TtrpgOpenCampaignFrontV1,
  TtrpgCampaignContentV2,
  TtrpgOpenAudience,
} from "./open-contract";
import type {
  TtrpgSituationActivationReasonV1,
  TtrpgSituationInstanceV1,
} from "./situation-engine";
import {
  advanceTtrpgWorldTimeV1,
  createTtrpgWorldTimeV1,
  type TtrpgWorldTimeAdvanceReason,
  type TtrpgWorldTimeV1,
} from "./world-time";

export const TTRPG_OPEN_FAILURE_CATEGORIES = [
  "fact-conflict",
  "gate-failed",
  "situation-rejected",
  "situation-capacity",
  "telegraph-missing",
  "oracle-scope-violation",
  "oracle-budget",
  "intent-unclear",
  "predicate-unresolvable",
  "budget-overflow",
  "media-degraded",
] as const;
export type TtrpgOpenFailureCategoryV1 =
  (typeof TTRPG_OPEN_FAILURE_CATEGORIES)[number];

export interface TtrpgOpenClockRuntimeStateV1 {
  clockKey: string;
  title: string;
  value: number;
  maximum: number;
  visibility: TtrpgOpenAudience;
  completed: boolean;
  lastAdvancedWorldTurn: number | null;
}

export interface TtrpgOpenFrontRuntimeStateV1 {
  frontKey: string;
  title: string;
  stageKey: string | null;
  defeated: boolean;
  telegraphedStageKeys: string[];
  lastEvaluatedWorldTurn: number | null;
}

export interface TtrpgOpenCompanionRuntimeStateV1 {
  actorKey: string;
  controller: "human" | "ai" | "hybrid" | "gm" | "open";
  consecutiveActions: number;
}

export interface TtrpgOpenGateRuntimeStateV1 {
  gateKey: string;
  status: "pending" | "passed" | "failed";
  evaluatedAtWorldTurn: number | null;
}

export interface TtrpgOpenFailureRuntimeStateV1 {
  failureKey: string;
  atSequence: number;
  atWorldTurn: number;
  category: TtrpgOpenFailureCategoryV1;
  violatedRule: string;
}

export interface TtrpgOpenSituationRuntimeStateV1
  extends Omit<TtrpgSituationInstanceV1, "status"> {
  status: "active" | "queued" | "resolved" | "expired";
  queuePosition: number | null;
}

export interface TtrpgOpenStageRuntimeStateV1 {
  status: "open" | "closed";
  openedAtWorldTurn: number;
  closedAtWorldTurn: number | null;
}

export interface TtrpgOpenRunStateV1 {
  schema: "storyforge.ttrpg-open-runtime";
  version: 1;
  runFormat: "open";
  worldTime: TtrpgWorldTimeV1;
  chaos: {
    value: number;
  };
  clocks: TtrpgOpenClockRuntimeStateV1[];
  fronts: TtrpgOpenFrontRuntimeStateV1[];
  companions: TtrpgOpenCompanionRuntimeStateV1[];
  gates: TtrpgOpenGateRuntimeStateV1[];
  failures: TtrpgOpenFailureRuntimeStateV1[];
  situations: {
    active: TtrpgOpenSituationRuntimeStateV1[];
    queued: TtrpgOpenSituationRuntimeStateV1[];
    cooldowns: Record<string, number>;
  };
  stage: TtrpgOpenStageRuntimeStateV1;
  consultedThisWorldTurn: number;
  coordination: TtrpgOpenCoordinationV1;
  operations: TtrpgOpenOperationV1[];
  ruleReceipts: TtrpgOpenRuleReceiptV1[];
}

/**
 * The V2 child state intentionally keeps the legacy scripted projection
 * fields. They remain a compatibility shell; open truth lives only in
 * `openRun`. The legacy parser never accepts this shape because it keeps its
 * exact eleven-key contract.
 */
export type TtrpgRuntimeStateV2 = TtrpgRuntimeState & {
  schema: "storyforge.ttrpg-runtime";
  version: 2;
  runFormat: "open";
  sessionKey: string;
  authorization: TtrpgOpenAuthorizationV1 | null;
  epochBudget: TtrpgOpenEpochBudgetV1;
  openRun: TtrpgOpenRunStateV1 | null;
};

function fail(message: string): never {
  throw new Error(`[ttrpg-open-runtime] ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} 必须是 JSON 对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(`${label} 必须是普通对象`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} 字段不精确：${actual.join(",")}`);
  }
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string") return fail(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    return fail(`${label} 无效`);
  }
  return normalized;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    return fail(`${label} 必须是安全整数`);
  }
  return Number(value);
}

function nullableInteger(
  value: unknown,
  label: string,
  minimum: number,
): number | null {
  if (value === null) return null;
  return integer(value, label, minimum);
}

function uniqueStrings(
  value: unknown,
  label: string,
  maximum = 10_000,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return fail(`${label} 必须是有限数组`);
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 500));
  if (new Set(result).size !== result.length) {
    return fail(`${label} 不能重复`);
  }
  return result;
}

function parseClock(value: unknown, index: number): TtrpgOpenClockRuntimeStateV1 {
  const row = record(value, `openRun.clocks[${index}]`);
  exact(
    row,
    [
      "clockKey",
      "title",
      "value",
      "maximum",
      "visibility",
      "completed",
      "lastAdvancedWorldTurn",
    ],
    `openRun.clocks[${index}]`,
  );
  const clockKey = text(row.clockKey, "clockKey");
  const title = text(row.title, "clock.title", 300);
  const maximum = integer(row.maximum, "clock.maximum", 1);
  const valueNumber = integer(row.value, "clock.value", 0);
  if (valueNumber > maximum) fail("clock.value 不能超过 maximum");
  if (
    row.visibility !== "gm-only" &&
    row.visibility !== "party" &&
    row.visibility !== "private" &&
    row.visibility !== "public"
  ) {
    fail("clock.visibility 无效");
  }
  if (typeof row.completed !== "boolean") fail("clock.completed 无效");
  const lastAdvancedWorldTurn = nullableInteger(
    row.lastAdvancedWorldTurn,
    "clock.lastAdvancedWorldTurn",
    0,
  );
  if (row.completed !== (valueNumber >= maximum)) {
    fail("clock.completed 与 clock.value 不一致");
  }
  return {
    clockKey,
    title,
    value: valueNumber,
    maximum,
    visibility: row.visibility,
    completed: row.completed,
    lastAdvancedWorldTurn,
  };
}

function parseFront(value: unknown, index: number): TtrpgOpenFrontRuntimeStateV1 {
  const row = record(value, `openRun.fronts[${index}]`);
  exact(
    row,
    [
      "frontKey",
      "title",
      "stageKey",
      "defeated",
      "telegraphedStageKeys",
      "lastEvaluatedWorldTurn",
    ],
    `openRun.fronts[${index}]`,
  );
  if (typeof row.defeated !== "boolean") fail("front.defeated 无效");
  return {
    frontKey: text(row.frontKey, "front.frontKey"),
    title: text(row.title, "front.title", 300),
    stageKey: nullableText(row.stageKey, "front.stageKey"),
    defeated: row.defeated,
    telegraphedStageKeys: uniqueStrings(
      row.telegraphedStageKeys,
      "front.telegraphedStageKeys",
    ),
    lastEvaluatedWorldTurn: nullableInteger(
      row.lastEvaluatedWorldTurn,
      "front.lastEvaluatedWorldTurn",
      0,
    ),
  };
}

function parseCompanion(
  value: unknown,
  index: number,
): TtrpgOpenCompanionRuntimeStateV1 {
  const row = record(value, `openRun.companions[${index}]`);
  exact(
    row,
    ["actorKey", "controller", "consecutiveActions"],
    `openRun.companions[${index}]`,
  );
  if (
    row.controller !== "human" &&
    row.controller !== "ai" &&
    row.controller !== "hybrid" &&
    row.controller !== "gm"
  ) {
    fail("companion.controller 无效");
  }
  return {
    actorKey: text(row.actorKey, "companion.actorKey"),
    controller: row.controller,
    consecutiveActions: integer(
      row.consecutiveActions,
      "companion.consecutiveActions",
      0,
    ),
  };
}

function parseGate(value: unknown, index: number): TtrpgOpenGateRuntimeStateV1 {
  const row = record(value, `openRun.gates[${index}]`);
  exact(
    row,
    ["gateKey", "status", "evaluatedAtWorldTurn"],
    `openRun.gates[${index}]`,
  );
  if (
    row.status !== "pending" &&
    row.status !== "passed" &&
    row.status !== "failed"
  ) {
    fail("gate.status 无效");
  }
  return {
    gateKey: text(row.gateKey, "gate.gateKey"),
    status: row.status,
    evaluatedAtWorldTurn: nullableInteger(
      row.evaluatedAtWorldTurn,
      "gate.evaluatedAtWorldTurn",
      0,
    ),
  };
}

export function parseTtrpgOpenFailureRuntimeStateV1(
  value: unknown,
  index = 0,
): TtrpgOpenFailureRuntimeStateV1 {
  const row = record(value, `openRun.failures[${index}]`);
  exact(
    row,
    ["failureKey", "atSequence", "atWorldTurn", "category", "violatedRule"],
    `openRun.failures[${index}]`,
  );
  if (
    !TTRPG_OPEN_FAILURE_CATEGORIES.includes(
      row.category as TtrpgOpenFailureCategoryV1,
    )
  ) {
    fail("failure.category 无效");
  }
  return {
    failureKey: text(row.failureKey, "failure.failureKey", 200),
    atSequence: integer(row.atSequence, "failure.atSequence", 1),
    atWorldTurn: integer(row.atWorldTurn, "failure.atWorldTurn", 0),
    category: row.category as TtrpgOpenFailureCategoryV1,
    violatedRule: text(row.violatedRule, "failure.violatedRule", 2_000),
  };
}

export function parseTtrpgOpenSituationRuntimeStateV1(
  value: unknown,
  label: string,
): TtrpgOpenSituationRuntimeStateV1 {
  const row = record(value, label);
  exact(
    row,
    [
      "situationKey",
      "templateKey",
      "status",
      "activatedAtSequence",
      "activatedAtWorldTurn",
      "activationReason",
      "whyNowRefs",
      "satisfiedObstacleKeys",
      "discoveredEvidenceRefs",
      "noInterventionDueWorldTurn",
      "resolvedAtSequence",
      "resolutionKind",
      "queuePosition",
    ],
    label,
  );
  if (
    row.status !== "active" &&
    row.status !== "queued" &&
    row.status !== "resolved" &&
    row.status !== "expired"
  ) {
    fail(`${label}.status 无效`);
  }
  if (
    row.activationReason !== "opening" &&
    row.activationReason !== "front-escalation" &&
    row.activationReason !== "consequence"
  ) {
    fail(`${label}.activationReason 无效`);
  }
  const resolutionKind =
    row.resolutionKind === null
      ? null
      : row.resolutionKind === "intervened" ||
          row.resolutionKind === "no-intervention" ||
          row.resolutionKind === "front-defeated" ||
          row.resolutionKind === "superseded"
        ? row.resolutionKind
        : fail(`${label}.resolutionKind 无效`);
  const queuePosition = nullableInteger(row.queuePosition, `${label}.queuePosition`, 0);
  if (row.status === "queued" && queuePosition === null) {
    fail(`${label}.queued 必须有 queuePosition`);
  }
  if (row.status !== "queued" && queuePosition !== null) {
    fail(`${label}.非 queued 不能有 queuePosition`);
  }
  return {
    situationKey: text(row.situationKey, `${label}.situationKey`, 200),
    templateKey: text(row.templateKey, `${label}.templateKey`, 200),
    status: row.status,
    activatedAtSequence: integer(
      row.activatedAtSequence,
      `${label}.activatedAtSequence`,
      1,
    ),
    activatedAtWorldTurn: integer(
      row.activatedAtWorldTurn,
      `${label}.activatedAtWorldTurn`,
      0,
    ),
    activationReason: row.activationReason as TtrpgSituationActivationReasonV1,
    whyNowRefs: uniqueStrings(row.whyNowRefs, `${label}.whyNowRefs`),
    satisfiedObstacleKeys: uniqueStrings(
      row.satisfiedObstacleKeys,
      `${label}.satisfiedObstacleKeys`,
    ),
    discoveredEvidenceRefs: uniqueStrings(
      row.discoveredEvidenceRefs,
      `${label}.discoveredEvidenceRefs`,
    ),
    noInterventionDueWorldTurn: integer(
      row.noInterventionDueWorldTurn,
      `${label}.noInterventionDueWorldTurn`,
      0,
    ),
    resolvedAtSequence: nullableInteger(
      row.resolvedAtSequence,
      `${label}.resolvedAtSequence`,
      1,
    ),
    resolutionKind,
    queuePosition,
  };
}

function parseWorldTime(value: unknown): TtrpgWorldTimeV1 {
  const row = record(value, "openRun.worldTime");
  exact(
    row,
    ["worldTurn", "lastAdvancedByEventSequence", "lastAdvanceReason"],
    "openRun.worldTime",
  );
  const worldTurn = integer(row.worldTurn, "worldTime.worldTurn", 0);
  const lastAdvancedByEventSequence = integer(
    row.lastAdvancedByEventSequence,
    "worldTime.lastAdvancedByEventSequence",
    -1,
  );
  const lastAdvanceReason = row.lastAdvanceReason;
  if (
    lastAdvanceReason !== null &&
    ![
      "game-action",
      "ai-companion-action",
      "idle-tick",
      "front-escalation",
      "situation-maintenance",
      "stage-close",
    ].includes(String(lastAdvanceReason))
  ) {
    fail("worldTime.lastAdvanceReason 无效");
  }
  return {
    worldTurn,
    lastAdvancedByEventSequence,
    lastAdvanceReason:
      lastAdvanceReason as TtrpgWorldTimeV1["lastAdvanceReason"],
  };
}

export function parseTtrpgOpenRunStateV1(
  value: unknown,
  sessionKey?: string,
): TtrpgOpenRunStateV1 {
  const row = record(value, "openRun");
  exact(
    row,
    [
      "schema",
      "version",
      "runFormat",
      "worldTime",
      "chaos",
      "clocks",
      "fronts",
      "companions",
      "gates",
      "failures",
      "situations",
      "stage",
      "consultedThisWorldTurn",
      "coordination",
      "operations",
      "ruleReceipts",
    ],
    "openRun",
  );
  if (
    row.schema !== "storyforge.ttrpg-open-runtime" ||
    row.version !== 1 ||
    row.runFormat !== "open"
  ) {
    fail("openRun schema/version/runFormat 无效");
  }
  const chaos = record(row.chaos, "openRun.chaos");
  exact(chaos, ["value"], "openRun.chaos");
  const chaosValue = integer(chaos.value, "openRun.chaos.value", 0);
  if (chaosValue > 100) fail("openRun.chaos.value 超出范围");
  const clocks = Array.isArray(row.clocks)
    ? row.clocks.map(parseClock)
    : fail("openRun.clocks 必须是数组");
  const fronts = Array.isArray(row.fronts)
    ? row.fronts.map(parseFront)
    : fail("openRun.fronts 必须是数组");
  const companions = Array.isArray(row.companions)
    ? row.companions.map(parseCompanion)
    : fail("openRun.companions 必须是数组");
  const gates = Array.isArray(row.gates)
    ? row.gates.map(parseGate)
    : fail("openRun.gates 必须是数组");
  const failures = Array.isArray(row.failures)
    ? row.failures.map(parseTtrpgOpenFailureRuntimeStateV1)
    : fail("openRun.failures 必须是数组");
  const situations = record(row.situations, "openRun.situations");
  exact(
    situations,
    ["active", "queued", "cooldowns"],
    "openRun.situations",
  );
  const active = Array.isArray(situations.active)
    ? situations.active.map((item) =>
        parseTtrpgOpenSituationRuntimeStateV1(
          item,
          "openRun.situations.active[]",
        ),
      )
    : fail("openRun.situations.active 必须是数组");
  const queued = Array.isArray(situations.queued)
    ? situations.queued.map((item) =>
        parseTtrpgOpenSituationRuntimeStateV1(
          item,
          "openRun.situations.queued[]",
        ),
      )
    : fail("openRun.situations.queued 必须是数组");
  if (active.length > 5) fail("openRun.active situations 不能超过 5 个");
  if (new Set([...active, ...queued].map((item) => item.situationKey)).size !== active.length + queued.length) {
    fail("openRun situations 不能重复");
  }
  const cooldowns = record(situations.cooldowns, "openRun.situations.cooldowns");
  const parsedCooldowns: Record<string, number> = {};
  for (const [key, value] of Object.entries(cooldowns)) {
    parsedCooldowns[text(key, "situation cooldown key", 200)] = integer(
      value,
      `openRun.situations.cooldowns.${key}`,
      0,
    );
  }
  const stage = record(row.stage, "openRun.stage");
  exact(
    stage,
    ["status", "openedAtWorldTurn", "closedAtWorldTurn"],
    "openRun.stage",
  );
  if (stage.status !== "open" && stage.status !== "closed") {
    fail("openRun.stage.status 无效");
  }
  const parsedStage: TtrpgOpenStageRuntimeStateV1 = {
    status: stage.status,
    openedAtWorldTurn: integer(
      stage.openedAtWorldTurn,
      "openRun.stage.openedAtWorldTurn",
      0,
    ),
    closedAtWorldTurn: nullableInteger(
      stage.closedAtWorldTurn,
      "openRun.stage.closedAtWorldTurn",
      0,
    ),
  };
  if (
    (parsedStage.status === "open") !== (parsedStage.closedAtWorldTurn === null)
  ) {
    fail("openRun.stage 开闭状态与时间不一致");
  }
  return {
    schema: "storyforge.ttrpg-open-runtime",
    version: 1,
    runFormat: "open",
    worldTime: parseWorldTime(row.worldTime),
    chaos: { value: chaosValue },
    clocks,
    fronts,
    companions,
    gates,
    failures,
    situations: {
      active,
      queued,
      cooldowns: parsedCooldowns,
    },
    stage: parsedStage,
    consultedThisWorldTurn: integer(
      row.consultedThisWorldTurn,
      "openRun.consultedThisWorldTurn",
      0,
    ),
    coordination: parseTtrpgOpenCoordinationV1(row.coordination, sessionKey),
    operations: Array.isArray(row.operations) ? row.operations.map(value => parseTtrpgOpenOperationV1(value, sessionKey)) : fail("operations 必须是数组"),
    ruleReceipts: Array.isArray(row.ruleReceipts) ? row.ruleReceipts.map(parseTtrpgOpenRuleReceiptV1) : fail("ruleReceipts 必须是数组"),
  };
}

export function parseTtrpgRuntimeStateV2(
  value: unknown,
): TtrpgRuntimeStateV2 | null {
  if (value == null) return null;
  const row = record(value, "正式 TTRPG open 运行态");
  exact(
    row,
    [
      "schema",
      "version",
      "runFormat",
      "sessionKey",
      "authorization",
      "epochBudget",
      "scene",
      "round",
      "activeActorKey",
      "turnOrder",
      "initiative",
      "actions",
      "checks",
      "attacks",
      "encounter",
      "campaign",
      "product",
      "openRun",
    ],
    "正式 TTRPG open 运行态",
  );
  if (row.schema !== "storyforge.ttrpg-runtime" || row.version !== 2 || row.runFormat !== "open") {
    fail("open 运行态 schema/version/runFormat 无效");
  }
  if (row.scene !== null || row.activeActorKey !== null || row.initiative !== null) {
    fail("open 运行态不能携带 scripted scene/initiative");
  }
  if (row.round !== 0) fail("open 运行态 compatibility round 必须为 0");
  if (!Array.isArray(row.turnOrder) || row.turnOrder.length !== 0) {
    fail("open 运行态 compatibility turnOrder 必须为空");
  }
  for (const key of ["actions", "checks", "attacks"]) {
    if (!Array.isArray(row[key])) fail(`open 运行态 ${key} 必须是数组`);
  }
  if (row.encounter !== null) fail("open 运行态不能携带 scripted encounter");
  // Validate shared mechanical fields with the existing strict parser in memory.
  // This validation view is never persisted or used for the original state hash.
  const { schema: _schema, version: _version, runFormat: _format, openRun: _run,
    sessionKey: _session, authorization: _authorization, epochBudget: _budget, ...mechanical } = row;
  const parsed = parseTtrpgOpenMechanicalStateV1(mechanical);
  if (!parsed) return fail("open 运行态 compatibility projection 不完整");
  const sessionKey = parseKey(row.sessionKey, "open.sessionKey");
  const authorization = row.authorization === null ? null : parseTtrpgOpenAuthorizationV1(row.authorization);
  const epochBudget = parseTtrpgOpenEpochBudgetV1(row.epochBudget);
  if (parsed.product.sessionZero.completed !== (authorization !== null)
    || (authorization !== null && (authorization.revision !== parsed.product.sessionZero.completedAtSequence
      || authorization.sourceRef.sessionKey !== sessionKey
      || authorization.completedBySeatKey !== parsed.product.sessionZero.completedBy
      || JSON.stringify([...authorization.selectedActorKeys].sort()) !== JSON.stringify([...parsed.product.sessionZero.selectedCharacterKeys].sort())))
    || (row.openRun !== null && authorization === null)) fail("open 授权与 Session Zero 状态不一致");
  const openRun = row.openRun === null ? null : parseTtrpgOpenRunStateV1(row.openRun, sessionKey);
  if (openRun && authorization) {
    if (new Set(openRun.operations.map(operation => operation.operationKey)).size !== openRun.operations.length
      || new Set(openRun.ruleReceipts.map(receipt => receipt.operationKey)).size !== openRun.ruleReceipts.length
      || openRun.operations.filter(operation => ["awaiting-approval", "executing"].includes(operation.status)).length > 1
      || openRun.operations.some(operation => operation.plan.epochKey !== operation.authorizationEpochKey
        || !openRun.coordination.epochs.some(epoch => epoch.epochKey === operation.authorizationEpochKey))
      || openRun.ruleReceipts.some(receipt => receipt.sourceRef.sessionKey !== sessionKey
        || !openRun.operations.some(operation => operation.operationKey === receipt.operationKey && operation.planHash === receipt.frozenPlanHash))) {
      fail("operation 身份/epoch/规则回执不一致");
    }
    for (const epoch of openRun.coordination.epochs) {
      const seat = authorization.seats.find(item => item.seatKey === epoch.triggeredBySeatKey && item.viewerKey === epoch.viewerKey);
      if (!seat || seat.controller === "ai" || seat.assignmentState !== "claimed"
        || epoch.sessionZeroRevision !== authorization.revision
        || stableProductRuntimeJsonV1(epoch.budget) !== stableProductRuntimeJsonV1(epochBudget)
        || epoch.successfulActorKeys.length > epochBudget.maximumAiActions
        || epoch.successfulActorKeys.some(actorKey => !authorization.seats.some(item => item.actorKey === actorKey && item.role === "player" && item.controller !== "human"))) {
        fail("epoch 与冻结预算、Session Zero 或队友控制权不一致");
      }
    }
  }
  return {
    ...parsed,
    schema: "storyforge.ttrpg-runtime",
    version: 2,
    runFormat: "open",
    sessionKey,
    authorization,
    epochBudget,
    openRun,
  };
}

function openClock(
  clock: TtrpgOpenCampaignClockV1,
): TtrpgOpenClockRuntimeStateV1 {
  return {
    clockKey: clock.clockKey,
    title: clock.title,
    value: clock.initialValue,
    maximum: clock.maximum,
    visibility: clock.visibility,
    completed: clock.initialValue >= clock.maximum,
    lastAdvancedWorldTurn: null,
  };
}

function openFront(
  front: TtrpgOpenCampaignFrontV1,
): TtrpgOpenFrontRuntimeStateV1 {
  return {
    frontKey: front.frontKey,
    title: front.title,
    stageKey: null,
    defeated: false,
    telegraphedStageKeys: [],
    lastEvaluatedWorldTurn: null,
  };
}

function companionController(
  character: TtrpgCampaignContentV2["characterTemplates"][number],
): TtrpgOpenCompanionRuntimeStateV1 {
  return {
    actorKey: character.characterKey,
    controller: character.controller,
    consecutiveActions: 0,
  };
}

export function createTtrpgOpenRunStateV1(
  campaign: TtrpgCampaignContentV2,
): TtrpgOpenRunStateV1 {
  const companions = campaign.characterTemplates
    .filter((character) => character.role === "player")
    .map(companionController);
  return {
    schema: "storyforge.ttrpg-open-runtime",
    version: 1,
    runFormat: "open",
    worldTime: createTtrpgWorldTimeV1(),
    chaos: { value: 5 },
    clocks: campaign.clocks.map(openClock),
    fronts: campaign.fronts.map(openFront),
    companions,
    gates: [],
    failures: [],
    situations: {
      active: [],
      queued: [],
      cooldowns: {},
    },
    stage: {
      status: "open",
      openedAtWorldTurn: 0,
      closedAtWorldTurn: null,
    },
    consultedThisWorldTurn: 0,
    coordination: { activeEpochKey: null, epochs: [] },
    operations: [],
    ruleReceipts: [],
  };
}

export function advanceOpenWorldTimeV1(
  state: TtrpgOpenRunStateV1,
  reason: TtrpgWorldTimeAdvanceReason,
  byEventSequence: number,
): TtrpgOpenRunStateV1 {
  const nextWorldTime = advanceTtrpgWorldTimeV1({
    worldTime: state.worldTime,
    reason,
    byEventSequence,
  });
  return {
    ...structuredClone(state),
    worldTime: nextWorldTime,
  };
}
