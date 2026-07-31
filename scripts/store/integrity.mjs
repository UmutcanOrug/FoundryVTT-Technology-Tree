import { hasDependencyCycle, wouldCreateDependencyCycle } from "../utils/graph-utils.mjs";
import { deepClone, hasUniqueIds } from "../utils/validation.mjs";

export function validateEnvelopeIntegrity(envelope) {
  const { catalog, researchState } = envelope;
  const groups = [catalog.entities, catalog.categories, catalog.technologies, catalog.modifiers, researchState.projects];
  for (const group of groups) {
    if (!hasUniqueIds(group)) throw new Error("Duplicate or missing IDs are not allowed.");
  }

  const allIds = groups.flat().map(item => item.id);
  if (allIds.length !== new Set(allIds).size) throw new Error("IDs must be unique across imported records.");

  const entityIds = new Set(catalog.entities.map(item => item.id));
  const categoryIds = new Set(catalog.categories.map(item => item.id));
  const technologyById = new Map(catalog.technologies.map(item => [item.id, item]));
  const modifierIds = new Set(catalog.modifiers.map(item => item.id));
  const projectById = new Map(researchState.projects.map(item => [item.id, item]));

  for (const entity of catalog.entities) {
    if (entity.categoryIds.some(id => !categoryIds.has(id))) throw new Error(`Entity ${entity.id} references an unknown category.`);
    for (const categoryId of entity.categoryIds) {
      if (!catalog.categories.find(category => category.id === categoryId)?.entityIds.includes(entity.id)) {
        throw new Error(`Entity ${entity.id} category membership is not symmetric.`);
      }
    }
    if (entity.modifierIds.some(id => !modifierIds.has(id)
      || catalog.modifiers.find(modifier => modifier.id === id)?.entityId !== entity.id)) {
      throw new Error(`Entity ${entity.id} references an unknown modifier.`);
    }
  }
  for (const category of catalog.categories) {
    if (category.entityIds.some(id => !entityIds.has(id))) throw new Error(`Category ${category.id} references an unknown entity.`);
    for (const entityId of category.entityIds) {
      if (!catalog.entities.find(entity => entity.id === entityId)?.categoryIds.includes(category.id)) {
        throw new Error(`Category ${category.id} membership is not symmetric.`);
      }
    }
  }

  const activeProjectsByEntity = new Map();
  for (const technology of catalog.technologies) {
    if (!entityIds.has(technology.entityId)) throw new Error(`Technology ${technology.id} references an unknown entity.`);
    if (!categoryIds.has(technology.categoryId)) throw new Error(`Technology ${technology.id} references an unknown category.`);
    if (!catalog.entities.find(entity => entity.id === technology.entityId)?.categoryIds.includes(technology.categoryId)) {
      throw new Error(`Technology ${technology.id} belongs to a category unavailable to its entity.`);
    }
    for (const prerequisiteId of technology.prerequisiteIds) {
      const prerequisite = technologyById.get(prerequisiteId);
      if (!prerequisite || prerequisite.entityId !== technology.entityId) {
        throw new Error(`Technology ${technology.id} has an invalid prerequisite.`);
      }
    }
    const rewardIds = [
      ...technology.activatedModifierIds,
      ...technology.onComplete.activateModifierIds,
      ...technology.onComplete.deactivateModifierIds
    ];
    if (rewardIds.some(id => !modifierIds.has(id)
      || catalog.modifiers.find(modifier => modifier.id === id)?.entityId !== technology.entityId)) {
      throw new Error(`Technology ${technology.id} references an unknown modifier.`);
    }
  }
  if (hasDependencyCycle(catalog.technologies)) throw new Error("Technology prerequisites contain a circular dependency.");

  for (const modifier of catalog.modifiers) {
    if (!entityIds.has(modifier.entityId)) throw new Error(`Modifier ${modifier.id} references an unknown entity.`);
    if (modifier.startWeek !== null && modifier.endWeek !== null && modifier.endWeek < modifier.startWeek) {
      throw new Error(`Modifier ${modifier.id} has an invalid date range.`);
    }
    const entity = catalog.entities.find(item => item.id === modifier.entityId);
    if (modifier.scopeType === "category" && !entity.categoryIds.includes(modifier.scopeId)) {
      throw new Error(`Modifier ${modifier.id} references an unknown category scope.`);
    }
    if (modifier.scopeType === "technology" && technologyById.get(modifier.scopeId)?.entityId !== modifier.entityId) {
      throw new Error(`Modifier ${modifier.id} references an unknown technology scope.`);
    }
    if (modifier.scopeType === "project" && projectById.get(modifier.scopeId)?.entityId !== modifier.entityId) {
      throw new Error(`Modifier ${modifier.id} references an unknown project scope.`);
    }
    if (modifier.scopeType === "tag" && !modifier.scopeId) throw new Error(`Modifier ${modifier.id} requires a tag scope.`);
    if (modifier.scopeType !== "all" && !modifier.scopeId) throw new Error(`Modifier ${modifier.id} requires a scope ID.`);
  }

  const activeTechnologyKeys = new Set();
  const activeEngineerIds = new Set();
  const rolledEngineerWeekKeys = new Set();
  for (const project of researchState.projects) {
    const technology = technologyById.get(project.technologyId);
    if (!entityIds.has(project.entityId) || !technology || technology.entityId !== project.entityId) {
      throw new Error(`Project ${project.id} references an unknown entity or technology.`);
    }
    const completed = new Set(researchState.completedTechnologyIdsByEntity[project.entityId] ?? []);
    if (project.status === "completed") {
      if (!completed.has(project.technologyId) || project.completedWeek === null) {
        throw new Error(`Completed project ${project.id} is inconsistent with completion state.`);
      }
    } else if (project.completedWeek !== null) {
      throw new Error(`Non-completed project ${project.id} has a completion week.`);
    }
    for (const [week, rolls] of Object.entries(project.weeklyRolls ?? {})) {
      for (const [slot, record] of Object.entries(rolls ?? {})) {
        if (!record?.actorUuid) continue;
        const rollKey = `${week}:${record.actorUuid}`;
        if (rolledEngineerWeekKeys.has(rollKey)) throw new Error("An engineer cannot roll more than once in the same week.");
        rolledEngineerWeekKeys.add(rollKey);
        if (project.status === "active" && Number(week) === researchState.currentWeek
          && project.engineers.find(engineer => engineer.slot === Number(slot))?.actorUuid !== record.actorUuid) {
          throw new Error(`Project ${project.id} has a roll for an unassigned engineer.`);
        }
      }
    }
    if (project.status === "active") {
      const key = `${project.entityId}:${project.technologyId}`;
      if (activeTechnologyKeys.has(key)) throw new Error("A technology cannot have more than one active project.");
      activeTechnologyKeys.add(key);
      activeProjectsByEntity.set(project.entityId, (activeProjectsByEntity.get(project.entityId) ?? 0) + 1);
      if (completed.has(project.technologyId) && !technology.repeatable) {
        throw new Error(`Project ${project.id} researches an already completed technology.`);
      }
      if (technology.prerequisiteIds.some(id => !completed.has(id))) {
        throw new Error(`Project ${project.id} has incomplete prerequisites.`);
      }
      for (const engineer of project.engineers) {
        if (!engineer.actorUuid) continue;
        if (activeEngineerIds.has(engineer.actorUuid)) throw new Error("An engineer cannot be assigned to more than one active slot.");
        activeEngineerIds.add(engineer.actorUuid);
      }
    }
  }
  for (const entity of catalog.entities) {
    if ((activeProjectsByEntity.get(entity.id) ?? 0) > entity.maxConcurrentProjects) {
      throw new Error(`Entity ${entity.id} exceeds its active project limit.`);
    }
  }

  for (const [entityId, technologyIds] of Object.entries(researchState.completedTechnologyIdsByEntity)) {
    if (!entityIds.has(entityId)) throw new Error(`Completion state references unknown entity ${entityId}.`);
    if (technologyIds.some(id => technologyById.get(id)?.entityId !== entityId)) {
      throw new Error(`Completion state for ${entityId} references an unknown technology.`);
    }
    const completed = new Set(technologyIds);
    if (technologyIds.some(id => technologyById.get(id).prerequisiteIds.some(prerequisiteId => !completed.has(prerequisiteId)))) {
      throw new Error(`Completion state for ${entityId} has incomplete prerequisites.`);
    }
  }
  return true;
}

export function repairEnvelopeIntegrity(envelope) {
  const repaired = deepClone(envelope);
  const { catalog, researchState } = repaired;
  const entityIds = new Set(catalog.entities.map(item => item.id));
  const categoryIds = new Set(catalog.categories.map(item => item.id));

  catalog.categories = catalog.categories.filter(category => {
    category.entityIds = category.entityIds.filter(id => entityIds.has(id));
    return Boolean(category.id);
  });
  const retainedCategoryIds = new Set(catalog.categories.map(item => item.id));
  for (const entity of catalog.entities) entity.categoryIds = entity.categoryIds.filter(id => retainedCategoryIds.has(id));
  for (const entity of catalog.entities) {
    for (const categoryId of entity.categoryIds) {
      const category = catalog.categories.find(item => item.id === categoryId);
      if (category && !category.entityIds.includes(entity.id)) category.entityIds.push(entity.id);
    }
  }
  for (const category of catalog.categories) {
    for (const entityId of category.entityIds) {
      const entity = catalog.entities.find(item => item.id === entityId);
      if (entity && !entity.categoryIds.includes(category.id)) entity.categoryIds.push(category.id);
    }
  }

  catalog.technologies = catalog.technologies.filter(technology => entityIds.has(technology.entityId)
    && retainedCategoryIds.has(technology.categoryId));
  const technologyById = new Map(catalog.technologies.map(item => [item.id, item]));

  const originalPrerequisites = new Map(catalog.technologies.map(technology => [technology.id, [...technology.prerequisiteIds]]));
  for (const technology of catalog.technologies) technology.prerequisiteIds = [];
  for (const technology of catalog.technologies) {
    const safePrerequisites = [];
    for (const prerequisiteId of originalPrerequisites.get(technology.id) ?? []) {
      if (prerequisiteId === technology.id) continue;
      const prerequisite = technologyById.get(prerequisiteId);
      if (!prerequisite || prerequisite.entityId !== technology.entityId) continue;
      if (!wouldCreateDependencyCycle(catalog.technologies, technology.id, [...safePrerequisites, prerequisiteId])) {
        safePrerequisites.push(prerequisiteId);
      }
    }
    technology.prerequisiteIds = safePrerequisites;
    const category = catalog.categories.find(item => item.id === technology.categoryId);
    const entity = catalog.entities.find(item => item.id === technology.entityId);
    if (category && !category.entityIds.includes(technology.entityId)) category.entityIds.push(technology.entityId);
    if (entity && !entity.categoryIds.includes(technology.categoryId)) entity.categoryIds.push(technology.categoryId);
  }

  catalog.modifiers = catalog.modifiers.filter(modifier => entityIds.has(modifier.entityId));
  const modifierIds = new Set(catalog.modifiers.map(item => item.id));
  for (const entity of catalog.entities) {
    const owned = catalog.modifiers.filter(modifier => modifier.entityId === entity.id).map(modifier => modifier.id);
    entity.modifierIds = [...new Set([
      ...entity.modifierIds.filter(id => modifierIds.has(id)
        && catalog.modifiers.find(modifier => modifier.id === id)?.entityId === entity.id),
      ...owned
    ])];
  }
  for (const technology of catalog.technologies) {
    const ownsModifier = id => modifierIds.has(id)
      && catalog.modifiers.find(modifier => modifier.id === id)?.entityId === technology.entityId;
    technology.activatedModifierIds = technology.activatedModifierIds.filter(ownsModifier);
    technology.onComplete.activateModifierIds = technology.onComplete.activateModifierIds.filter(ownsModifier);
    technology.onComplete.deactivateModifierIds = technology.onComplete.deactivateModifierIds.filter(ownsModifier);
  }

  const activeTechnologyKeys = new Set();
  researchState.projects = researchState.projects.filter(project => {
    const technology = technologyById.get(project.technologyId);
    if (!entityIds.has(project.entityId) || !technology || technology.entityId !== project.entityId) return false;
    if (project.status !== "active") return true;
    const key = `${project.entityId}:${project.technologyId}`;
    if (activeTechnologyKeys.has(key)) return false;
    activeTechnologyKeys.add(key);
    return true;
  });

  const projectById = new Map(researchState.projects.map(item => [item.id, item]));
  const technologyByIdAfterRepair = new Map(catalog.technologies.map(item => [item.id, item]));
  for (const modifier of catalog.modifiers) {
    if (modifier.startWeek !== null && modifier.endWeek !== null && modifier.endWeek < modifier.startWeek) {
      [modifier.startWeek, modifier.endWeek] = [modifier.endWeek, modifier.startWeek];
    }
    const entity = catalog.entities.find(item => item.id === modifier.entityId);
    const validScope = modifier.scopeType === "all"
      || (modifier.scopeType === "category" && entity?.categoryIds.includes(modifier.scopeId))
      || (modifier.scopeType === "technology" && technologyByIdAfterRepair.get(modifier.scopeId)?.entityId === modifier.entityId)
      || (modifier.scopeType === "project" && projectById.get(modifier.scopeId)?.entityId === modifier.entityId)
      || (modifier.scopeType === "tag" && Boolean(modifier.scopeId));
    if (!validScope) {
      modifier.scopeType = "all";
      modifier.scopeId = "";
      modifier.active = false;
    }
  }

  const completed = {};
  for (const [entityId, ids] of Object.entries(researchState.completedTechnologyIdsByEntity)) {
    if (!entityIds.has(entityId)) continue;
    const retained = new Set(ids.filter(id => technologyById.get(id)?.entityId === entityId));
    let changed = true;
    while (changed) {
      changed = false;
      for (const technologyId of [...retained]) {
        if (technologyById.get(technologyId).prerequisiteIds.some(prerequisiteId => !retained.has(prerequisiteId))) {
          retained.delete(technologyId);
          changed = true;
        }
      }
    }
    completed[entityId] = [...retained];
  }
  researchState.completedTechnologyIdsByEntity = completed;

  const completedSets = new Map(Object.entries(completed).map(([entityId, ids]) => [entityId, new Set(ids)]));
  const activeCounts = new Map();
  researchState.projects = researchState.projects.filter(project => {
    if (project.status !== "active") return true;
    const technology = technologyByIdAfterRepair.get(project.technologyId);
    const completedForEntity = completedSets.get(project.entityId) ?? new Set();
    if (completedForEntity.has(project.technologyId) && !technology.repeatable) return false;
    if (technology.prerequisiteIds.some(id => !completedForEntity.has(id))) return false;
    const entity = catalog.entities.find(item => item.id === project.entityId);
    const count = activeCounts.get(project.entityId) ?? 0;
    if (count >= entity.maxConcurrentProjects) return false;
    activeCounts.set(project.entityId, count + 1);
    return true;
  });
  const activeEngineerIds = new Set();
  const rolledEngineerWeekKeys = new Set();
  for (const project of researchState.projects) {
    const completedForEntity = completedSets.get(project.entityId) ?? new Set();
    if (project.status === "completed") {
      if (!completedForEntity.has(project.technologyId)) {
        project.status = "cancelled";
        project.completedWeek = null;
      } else if (project.completedWeek === null) {
        project.completedWeek = researchState.currentWeek;
      }
    } else {
      project.completedWeek = null;
    }
    if (project.status === "active") {
      for (const engineer of project.engineers) {
        if (!engineer.actorUuid) continue;
        if (activeEngineerIds.has(engineer.actorUuid)) engineer.actorUuid = null;
        else activeEngineerIds.add(engineer.actorUuid);
      }
    }
    for (const [week, rolls] of Object.entries(project.weeklyRolls ?? {})) {
      for (const slot of [1, 2]) {
        const record = rolls?.[slot];
        if (!record?.actorUuid) continue;
        const rollKey = `${week}:${record.actorUuid}`;
        const assignment = project.engineers.find(engineer => engineer.slot === slot);
        const mismatchedCurrentAssignment = project.status === "active" && Number(week) === researchState.currentWeek
          && assignment?.actorUuid !== record.actorUuid;
        if (rolledEngineerWeekKeys.has(rollKey) || mismatchedCurrentAssignment) delete rolls[slot];
        else rolledEngineerWeekKeys.add(rollKey);
      }
    }
  }
  const finalProjectById = new Map(researchState.projects.map(item => [item.id, item]));
  for (const modifier of catalog.modifiers) {
    if (modifier.scopeType === "project" && finalProjectById.get(modifier.scopeId)?.entityId !== modifier.entityId) {
      modifier.scopeType = "all";
      modifier.scopeId = "";
      modifier.active = false;
    }
  }
  return repaired;
}
