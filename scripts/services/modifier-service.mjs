import {
  MODIFIER_OPERATIONS,
  MODIFIER_SCOPES,
  MODIFIER_TARGETS
} from "../constants.mjs";

export function modifierMatchesScope(modifier, { technology, project }) {
  switch (modifier.scopeType) {
    case MODIFIER_SCOPES.ALL:
      return true;
    case MODIFIER_SCOPES.CATEGORY:
      return modifier.scopeId === technology?.categoryId;
    case MODIFIER_SCOPES.TECHNOLOGY:
      return modifier.scopeId === technology?.id;
    case MODIFIER_SCOPES.TAG:
      return technology?.tags?.includes(modifier.scopeId) ?? false;
    case MODIFIER_SCOPES.PROJECT:
      return modifier.scopeId === project?.id;
    default:
      return false;
  }
}

export function isModifierActive(modifier, { week, entityId, technology, project }) {
  if (!modifier?.active || modifier.entityId !== entityId) return false;
  if (modifier.startWeek !== null && week < modifier.startWeek) return false;
  if (modifier.endWeek !== null && week > modifier.endWeek) return false;
  return modifierMatchesScope(modifier, { technology, project });
}

export function activeModifiersFor(catalog, context) {
  return (catalog?.modifiers ?? []).filter(modifier => isModifierActive(modifier, context));
}

export function modifierIsCurrentlyActive(modifier, { week, projects = [] } = {}) {
  if (!modifier?.active) return false;
  if (modifier.startWeek !== null && week < modifier.startWeek) return false;
  if (modifier.endWeek !== null && week > modifier.endWeek) return false;
  if (modifier.scopeType === MODIFIER_SCOPES.PROJECT) {
    return projects.some(project => project.id === modifier.scopeId && project.status === "active");
  }
  return true;
}

function modifierPair(modifiers, target) {
  let add = 0;
  let multiply = 1;
  for (const modifier of modifiers) {
    if (modifier.target !== target) continue;
    if (modifier.operation === MODIFIER_OPERATIONS.ADD) add += Number(modifier.value) || 0;
    if (modifier.operation === MODIFIER_OPERATIONS.MULTIPLY) multiply *= Number(modifier.value) || 0;
  }
  return { add, multiply };
}

export function calculateWeeklyResearch({
  workers,
  basePointsPerWorker,
  engineerPoints = [],
  modifiers = []
}) {
  const worker = modifierPair(modifiers, MODIFIER_TARGETS.WORKER_EFFICIENCY);
  const passive = modifierPair(modifiers, MODIFIER_TARGETS.PASSIVE_POINTS);
  const engineer = modifierPair(modifiers, MODIFIER_TARGETS.ENGINEER_POINTS);
  const weekly = modifierPair(modifiers, MODIFIER_TARGETS.WEEKLY_TOTAL);

  const passiveBase = Math.max(0, Math.trunc(Number(workers) || 0)) * Math.max(0, Number(basePointsPerWorker) || 0);
  const workerAdjusted = Math.floor((passiveBase + worker.add) * worker.multiply);
  const passiveAdjusted = Math.floor((workerAdjusted + passive.add) * passive.multiply);
  const engineerBase = engineerPoints.reduce((total, points) => total + Math.max(0, Number(points) || 0), 0);
  const engineerAdjusted = Math.floor((engineerBase + engineer.add) * engineer.multiply);
  const weeklyTotal = Math.max(0, Math.floor((passiveAdjusted + engineerAdjusted + weekly.add) * weekly.multiply));

  return {
    passiveBase,
    workerAdjusted,
    passiveAdjusted,
    engineerBase,
    engineerAdjusted,
    weeklyFlat: weekly.add,
    weeklyMultiplier: weekly.multiply,
    weeklyTotal,
    modifierDelta: weeklyTotal - passiveBase - engineerBase
  };
}

export function effectiveResearchCost(baseCost, modifiers = []) {
  const cost = modifierPair(modifiers, MODIFIER_TARGETS.RESEARCH_COST);
  return Math.max(1, Math.floor((Math.max(1, Number(baseCost) || 1) + cost.add) * cost.multiply));
}

export function modifierIsBuff(modifier) {
  const value = Number(modifier?.value) || 0;
  if (modifier?.target === MODIFIER_TARGETS.RESEARCH_COST) {
    return modifier?.operation === MODIFIER_OPERATIONS.MULTIPLY ? value <= 1 : value <= 0;
  }
  return modifier?.operation === MODIFIER_OPERATIONS.MULTIPLY ? value >= 1 : value >= 0;
}

export function modifierMagnitudeText(modifier) {
  const value = Number(modifier?.value) || 0;
  if (modifier?.operation === MODIFIER_OPERATIONS.MULTIPLY) {
    const percent = Math.round(Math.abs(value - 1) * 100);
    return `${value >= 1 ? "+" : "-"}${percent}%`;
  }
  return `${value >= 0 ? "+" : ""}${value}`;
}
