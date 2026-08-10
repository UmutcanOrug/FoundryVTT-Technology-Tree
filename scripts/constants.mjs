export const MODULE_ID = "research-tech-tree";
export const MODULE_TITLE = "Research Tech Tree";
export const MODULE_VERSION = "0.1.5";
export const SCHEMA_VERSION = 4;
export const SOCKET_CHANNEL = `module.${MODULE_ID}`;

export const SETTINGS = Object.freeze({
  SCHEMA_VERSION: "schemaVersion",
  CATALOG: "catalog",
  RESEARCH_STATE: "researchState",
  MODULE_CONFIG: "moduleConfig",
  DATA_REVISION: "dataRevision",
  CLIENT_STATE: "clientState"
});

export const ENTITY_TYPES = Object.freeze({
  COUNTRY: "country",
  FACILITY: "facility",
  PERSONAL: "personal"
});

export const TECHNOLOGY_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  HIDDEN: "hidden",
  SECRET_UNTIL_AVAILABLE: "secretUntilAvailable"
});

export const TECHNOLOGY_STATUS = Object.freeze({
  HIDDEN: "hidden",
  LOCKED: "locked",
  AVAILABLE: "available",
  IN_PROGRESS: "inProgress",
  COMPLETED: "completed"
});

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
});

export const ROLL_MODES = Object.freeze({
  SWADE_SKILL: "swadeSkill",
  FORMULA: "formula",
  MANUAL: "manual",
  SYSTEM_ADAPTER: "systemAdapter"
});

export const RESULT_METHODS = Object.freeze({
  DIRECT_TOTAL: "directTotal",
  RESULT_BANDS: "resultBands"
});

export const MODIFIER_OPERATIONS = Object.freeze({
  ADD: "add",
  MULTIPLY: "multiply"
});

export const MODIFIER_TARGETS = Object.freeze({
  PASSIVE_POINTS: "passivePoints",
  ENGINEER_POINTS: "engineerPoints",
  WEEKLY_TOTAL: "weeklyTotal",
  WORKER_EFFICIENCY: "workerEfficiency",
  RESEARCH_COST: "researchCost"
});

export const MODIFIER_SCOPES = Object.freeze({
  ALL: "all",
  CATEGORY: "category",
  TECHNOLOGY: "technology",
  TAG: "tag",
  PROJECT: "project"
});

export const DEFAULT_TECH_ICON = `modules/${MODULE_ID}/assets/default-tech-icon.svg`;
export const DEFAULT_ENTITY_ICON = "icons/svg/castle.svg";

export const LIMITS = Object.freeze({
  MAX_IMPORT_BYTES: 20 * 1024 * 1024,
  MIN_ZOOM: 0.35,
  MAX_ZOOM: 2,
  NODE_WIDTH: 220,
  NODE_HEIGHT: 126,
  TREE_PADDING: 180,
  SOCKET_TIMEOUT_MS: 15_000,
  MAX_PROCESSED_REQUEST_IDS: 500
});

export function localize(key, data = undefined) {
  const fullKey = key.startsWith("RTT.") ? key : `RTT.${key}`;
  const i18n = globalThis.game?.i18n;
  if (!i18n) return fullKey;
  return data ? i18n.format(fullKey, data) : i18n.localize(fullKey);
}

export function reportError(scope, error, { notify = true } = {}) {
  const message = error?.message || String(error);
  const hook = globalThis.Hooks?.onError;
  if (typeof hook === "function") {
    hook(`${MODULE_ID}.${scope}`, error, { log: "error", notify: notify ? "error" : null });
  } else {
    console.error(`${MODULE_ID} | ${scope}`, error);
    if (notify) globalThis.ui?.notifications?.error?.(message);
  }
}
