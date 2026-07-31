import { TECHNOLOGY_STATUS, TECHNOLOGY_VISIBILITY } from "../constants.mjs";

export function technologyMap(technologies) {
  return new Map((technologies ?? []).map(technology => [technology.id, technology]));
}

export function hasDependencyCycle(technologies) {
  const map = technologyMap(technologies);
  const visiting = new Set();
  const visited = new Set();

  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const technology = map.get(id);
    for (const prerequisiteId of technology?.prerequisiteIds ?? []) {
      if (map.has(prerequisiteId) && visit(prerequisiteId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return [...map.keys()].some(visit);
}

export function wouldCreateDependencyCycle(technologies, technologyId, prerequisiteIds) {
  const proposed = (technologies ?? []).map(technology => technology.id === technologyId
    ? { ...technology, prerequisiteIds: [...prerequisiteIds] }
    : technology);
  return hasDependencyCycle(proposed);
}

export function getCompletedSet(state, entityId) {
  return new Set(state?.completedTechnologyIdsByEntity?.[entityId] ?? []);
}

export function getProjectForTechnology(state, entityId, technologyId) {
  return (state?.projects ?? []).find(project => project.entityId === entityId
    && project.technologyId === technologyId
    && project.status === "active");
}

export function prerequisitesMet(technology, state) {
  const completed = getCompletedSet(state, technology.entityId);
  return (technology.prerequisiteIds ?? []).every(id => completed.has(id));
}

export function getTechnologyStatus(technology, state, { isGM = false } = {}) {
  const completed = getCompletedSet(state, technology.entityId);
  const project = getProjectForTechnology(state, technology.entityId, technology.id);
  if (project && (technology.repeatable || !completed.has(technology.id))) return TECHNOLOGY_STATUS.IN_PROGRESS;
  if (completed.has(technology.id)) return TECHNOLOGY_STATUS.COMPLETED;
  if (project) return TECHNOLOGY_STATUS.IN_PROGRESS;
  if (!isGM && technology.visibility === TECHNOLOGY_VISIBILITY.HIDDEN) return TECHNOLOGY_STATUS.HIDDEN;
  return prerequisitesMet(technology, state) ? TECHNOLOGY_STATUS.AVAILABLE : TECHNOLOGY_STATUS.LOCKED;
}

export function technologyVisibleToPlayer(technology, state) {
  if (technology.visibility === TECHNOLOGY_VISIBILITY.HIDDEN) return false;
  if (technology.visibility !== TECHNOLOGY_VISIBILITY.SECRET_UNTIL_AVAILABLE) return true;
  const status = getTechnologyStatus(technology, state, { isGM: false });
  return status !== TECHNOLOGY_STATUS.LOCKED && status !== TECHNOLOGY_STATUS.HIDDEN;
}

export function unlockedTechnologyIds(technologyId, technologies) {
  return (technologies ?? [])
    .filter(technology => technology.prerequisiteIds?.includes(technologyId))
    .map(technology => technology.id);
}

export function sortByOrderThenName(items, locale = "en") {
  return [...(items ?? [])].sort((left, right) => {
    const order = Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0);
    return order || String(left.name ?? "").localeCompare(String(right.name ?? ""), locale);
  });
}
