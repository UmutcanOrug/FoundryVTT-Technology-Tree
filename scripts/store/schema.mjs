import {
  DEFAULT_ENTITY_ICON,
  DEFAULT_TECH_ICON,
  ENTITY_TYPES,
  MODIFIER_OPERATIONS,
  MODIFIER_SCOPES,
  MODIFIER_TARGETS,
  PROJECT_STATUS,
  RESULT_METHODS,
  ROLL_MODES,
  SCHEMA_VERSION,
  TECHNOLOGY_VISIBILITY
} from "../constants.mjs";
import {
  asArray,
  asBoolean,
  asEnum,
  asInteger,
  asNumber,
  asString,
  asText,
  uniqueStrings
} from "../utils/validation.mjs";

export function defaultCatalog() {
  return { entities: [], categories: [], technologies: [], modifiers: [] };
}

export function defaultResearchState() {
  return {
    currentWeek: 1,
    projects: [],
    completedTechnologyIdsByEntity: {},
    history: [],
    processedRequestIds: []
  };
}

export function defaultModuleConfig() {
  return {
    rollMode: ROLL_MODES.SWADE_SKILL,
    engineeringFormula: "1d20",
    resultMethod: RESULT_METHODS.DIRECT_TOTAL,
    resultBands: [
      { min: 0, max: 3, points: 0 },
      { min: 4, max: 7, points: 2 },
      { min: 8, max: 11, points: 4 },
      { min: 12, max: 999, points: 6 }
    ],
    systemAdapterId: "",
    historyLimit: 100
  };
}

export function defaultClientState() {
  return {
    selectedEntityId: "",
    activeTabByEntity: {},
    viewByTree: {}
  };
}

export function normalizeEntity(raw = {}) {
  raw = recordOrEmpty(raw);
  const type = asEnum(raw.type, ENTITY_TYPES, ENTITY_TYPES.COUNTRY);
  const defaultName = type === ENTITY_TYPES.FACILITY
    ? "Research Facility"
    : type === ENTITY_TYPES.PERSONAL ? "Personal Research" : "Country";
  return {
    id: asString(raw.id),
    type,
    name: asString(raw.name, defaultName),
    icon: asString(raw.icon, DEFAULT_ENTITY_ICON),
    banner: asString(raw.banner),
    description: asText(raw.description),
    lore: asText(raw.lore),
    public: asBoolean(raw.public, true),
    allowedUserIds: uniqueStrings(raw.allowedUserIds),
    categoryIds: uniqueStrings(raw.categoryIds),
    modifierIds: uniqueStrings(raw.modifierIds),
    researchSkill: asString(raw.researchSkill, "engineering").toLocaleLowerCase("en-US"),
    researchSkillName: asString(raw.researchSkillName),
    rpOnSuccess: asInteger(raw.rpOnSuccess, 1, { min: 0 }),
    rpPerRaise: asInteger(raw.rpPerRaise, 1, { min: 0 }),
    basePointsPerWorker: asNumber(raw.basePointsPerWorker, 1, { min: 0 }),
    maxConcurrentProjects: asInteger(raw.maxConcurrentProjects, 2, { min: 0 }),
    sortOrder: asNumber(raw.sortOrder, 0)
  };
}

export function normalizeCategory(raw = {}) {
  raw = recordOrEmpty(raw);
  return {
    id: asString(raw.id),
    name: asString(raw.name, "Category"),
    icon: asString(raw.icon, "fa-solid fa-diagram-project"),
    description: asText(raw.description),
    entityIds: uniqueStrings(raw.entityIds),
    sortOrder: asNumber(raw.sortOrder, 0)
  };
}

export function normalizeTechnology(raw = {}) {
  raw = recordOrEmpty(raw);
  const onComplete = raw.onComplete && typeof raw.onComplete === "object" ? raw.onComplete : {};
  return {
    id: asString(raw.id),
    entityId: asString(raw.entityId),
    categoryId: asString(raw.categoryId),
    name: asString(raw.name, "Technology"),
    icon: asString(raw.icon, DEFAULT_TECH_ICON),
    description: asText(raw.description),
    researchPointCost: asInteger(raw.researchPointCost ?? raw.cost, 1, { min: 1 }),
    x: asNumber(raw.x, 80),
    y: asNumber(raw.y, 80),
    prerequisiteIds: uniqueStrings(raw.prerequisiteIds ?? raw.prerequisiteTechnologyIds),
    tags: uniqueStrings(raw.tags),
    visibility: asEnum(raw.visibility, TECHNOLOGY_VISIBILITY, TECHNOLOGY_VISIBILITY.PUBLIC),
    repeatable: asBoolean(raw.repeatable, false),
    activatedModifierIds: uniqueStrings(raw.activatedModifierIds ?? raw.modifierIds),
    onComplete: {
      activateModifierIds: uniqueStrings(onComplete.activateModifierIds ?? raw.activateModifierIds),
      deactivateModifierIds: uniqueStrings(onComplete.deactivateModifierIds ?? raw.deactivateModifierIds)
    },
    sortOrder: asNumber(raw.sortOrder, 0)
  };
}

export function normalizeModifier(raw = {}) {
  raw = recordOrEmpty(raw);
  const operation = asEnum(raw.operation, MODIFIER_OPERATIONS, MODIFIER_OPERATIONS.ADD);
  return {
    id: asString(raw.id),
    entityId: asString(raw.entityId),
    name: asString(raw.name, "Research Modifier"),
    description: asText(raw.description),
    active: asBoolean(raw.active, true),
    source: asString(raw.source),
    operation,
    target: asEnum(raw.target, MODIFIER_TARGETS, MODIFIER_TARGETS.WEEKLY_TOTAL),
    scopeType: asEnum(raw.scopeType, MODIFIER_SCOPES, MODIFIER_SCOPES.ALL),
    scopeId: asString(raw.scopeId),
    value: asNumber(raw.value, operation === MODIFIER_OPERATIONS.MULTIPLY ? 1 : 0, {
      min: operation === MODIFIER_OPERATIONS.MULTIPLY ? 0 : -Infinity
    }),
    startWeek: raw.startWeek === null || raw.startWeek === "" || raw.startWeek === undefined
      ? null : asInteger(raw.startWeek, null, { min: 1 }),
    endWeek: raw.endWeek === null || raw.endWeek === "" || raw.endWeek === undefined
      ? null : asInteger(raw.endWeek, null, { min: 1 })
  };
}

export function normalizeEngineer(raw = {}, slot = 1) {
  raw = recordOrEmpty(raw);
  return {
    slot: slot === 2 ? 2 : 1,
    actorUuid: asString(raw.actorUuid) || null
  };
}

export function normalizeWeeklyRolls(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [week, slots] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/u.test(week)) continue;
    const normalizedWeek = Number(week);
    if (!Number.isSafeInteger(normalizedWeek) || !slots || typeof slots !== "object" || Array.isArray(slots)) continue;
    result[normalizedWeek] = {};
    for (const slot of [1, 2]) {
      const value = slots[slot] ?? slots[String(slot)];
      if (!value || typeof value !== "object") continue;
      result[normalizedWeek][slot] = {
        total: asNumber(value.total, 0),
        points: asInteger(value.points, 0, { min: 0 }),
        actorUuid: asString(value.actorUuid),
        requestId: asString(value.requestId),
        rolledByUserId: asString(value.rolledByUserId),
        timestamp: asNumber(value.timestamp, Date.now()),
        formula: asString(value.formula),
        mode: asString(value.mode),
        skillName: asString(value.skillName),
        skillSwid: asString(value.skillSwid),
        success: asBoolean(value.success, asString(value.mode) === ROLL_MODES.SWADE_SKILL && asNumber(value.total, 0) >= 4),
        raiseCount: asInteger(value.raiseCount, 0, { min: 0 }),
        bennyRerolls: asInteger(value.bennyRerolls, 0, { min: 0 }),
        lastRerollTotal: value.lastRerollTotal === null || value.lastRerollTotal === undefined
          ? null : asNumber(value.lastRerollTotal, null),
        lastRequestId: asString(value.lastRequestId)
      };
    }
  }
  return result;
}

export function normalizeProject(raw = {}) {
  raw = recordOrEmpty(raw);
  const engineers = asArray(raw.engineers);
  return {
    id: asString(raw.id),
    entityId: asString(raw.entityId),
    technologyId: asString(raw.technologyId),
    status: asEnum(raw.status, PROJECT_STATUS, PROJECT_STATUS.ACTIVE),
    progress: asInteger(raw.progress, 0, { min: 0 }),
    assignedWorkers: asInteger(raw.assignedWorkers, 0, { min: 0 }),
    engineers: [
      normalizeEngineer(engineers.find(engineer => Number(engineer?.slot) === 1), 1),
      normalizeEngineer(engineers.find(engineer => Number(engineer?.slot) === 2), 2)
    ],
    weeklyRolls: normalizeWeeklyRolls(raw.weeklyRolls),
    startedWeek: asInteger(raw.startedWeek, 1, { min: 1 }),
    completedWeek: raw.completedWeek === null || raw.completedWeek === undefined || raw.completedWeek === ""
      ? null : asInteger(raw.completedWeek, null, { min: 1 }),
    paused: asBoolean(raw.paused, false)
  };
}

export function normalizeCatalog(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const uniqueById = (values, normalize) => {
    const result = [];
    const seen = new Set();
    for (const value of asArray(values)) {
      const item = normalize(value);
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
    return result;
  };
  return {
    entities: uniqueById(source.entities, normalizeEntity),
    categories: uniqueById(source.categories, normalizeCategory),
    technologies: uniqueById(source.technologies, normalizeTechnology),
    modifiers: uniqueById(source.modifiers, normalizeModifier)
  };
}

export function normalizeResearchState(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const completedTechnologyIdsByEntity = {};
  if (source.completedTechnologyIdsByEntity && typeof source.completedTechnologyIdsByEntity === "object") {
    for (const [entityId, ids] of Object.entries(source.completedTechnologyIdsByEntity)) {
      const normalizedEntityId = asString(entityId);
      if (!normalizedEntityId) continue;
      completedTechnologyIdsByEntity[normalizedEntityId] = [...new Set([
        ...(completedTechnologyIdsByEntity[normalizedEntityId] ?? []),
        ...uniqueStrings(ids)
      ])];
    }
  }
  const projects = [];
  const seen = new Set();
  for (const rawProject of asArray(source.projects)) {
    const project = normalizeProject(rawProject);
    if (!project.id || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  return {
    currentWeek: asInteger(source.currentWeek, 1, { min: 1 }),
    projects,
    completedTechnologyIdsByEntity,
    processedRequestIds: uniqueStrings(source.processedRequestIds).slice(-500),
    history: asArray(source.history)
      .filter(entry => entry && typeof entry === "object")
      .map(entry => ({ ...entry, week: asInteger(entry.week, 1, { min: 1 }) }))
  };
}

export function normalizeModuleConfig(raw = {}) {
  const defaults = defaultModuleConfig();
  const source = raw && typeof raw === "object" ? raw : {};
  const bands = asArray(source.resultBands).map(band => ({
    min: asNumber(band?.min, 0),
    max: asNumber(band?.max, 0),
    points: asInteger(band?.points, 0, { min: 0 })
  })).filter(band => band.max >= band.min);
  return {
    rollMode: asEnum(source.rollMode, ROLL_MODES, defaults.rollMode),
    engineeringFormula: asString(source.engineeringFormula, defaults.engineeringFormula),
    resultMethod: asEnum(source.resultMethod, RESULT_METHODS, defaults.resultMethod),
    resultBands: (bands.length ? bands : defaults.resultBands).sort((a, b) => a.min - b.min),
    systemAdapterId: asString(source.systemAdapterId),
    historyLimit: asInteger(source.historyLimit, defaults.historyLimit, { min: 1, max: 1000 })
  };
}

export function normalizeClientState(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const objectOrEmpty = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    selectedEntityId: asString(source.selectedEntityId),
    activeTabByEntity: { ...objectOrEmpty(source.activeTabByEntity) },
    viewByTree: { ...objectOrEmpty(source.viewByTree) }
  };
}

export function defaultWorldEnvelope() {
  return {
    schemaVersion: SCHEMA_VERSION,
    catalog: defaultCatalog(),
    researchState: defaultResearchState(),
    moduleConfig: defaultModuleConfig()
  };
}

function recordOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
