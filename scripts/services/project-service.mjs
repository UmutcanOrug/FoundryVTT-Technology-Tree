import { PROJECT_STATUS, localize } from "../constants.mjs";
import { activeModifiersFor, effectiveResearchCost } from "./modifier-service.mjs";
import { getCompletedSet, prerequisitesMet } from "../utils/graph-utils.mjs";
import { asInteger, asString, createStableId } from "../utils/validation.mjs";

export class ProjectService {
  constructor(store) {
    this.store = store;
  }

  validateStart(envelope, entityId, technologyId) {
    const { catalog, researchState } = envelope;
    const entity = catalog.entities.find(item => item.id === entityId);
    const technology = catalog.technologies.find(item => item.id === technologyId && item.entityId === entityId);
    if (!entity || !technology) throw new Error(localize("Errors.TechnologyNotFound"));
    if (getCompletedSet(researchState, entityId).has(technologyId) && !technology.repeatable) {
      throw new Error(localize("Errors.AlreadyCompleted"));
    }
    if (researchState.projects.some(project => project.entityId === entityId
      && project.technologyId === technologyId
      && project.status === PROJECT_STATUS.ACTIVE)) {
      throw new Error(localize("Errors.ProjectAlreadyActive"));
    }
    if (!prerequisitesMet(technology, researchState)) throw new Error(localize("Errors.Prerequisites"));
    const activeCount = researchState.projects.filter(project => project.entityId === entityId
      && project.status === PROJECT_STATUS.ACTIVE).length;
    if (activeCount >= entity.maxConcurrentProjects) throw new Error(localize("Errors.ProjectCapacity"));
    return { entity, technology };
  }

  async start(entityId, technologyId) {
    let createdId = "";
    await this.store.transaction("startResearch", envelope => {
      this.validateStart(envelope, entityId, technologyId);
      createdId = createStableId("project");
      envelope.researchState.projects.push({
        id: createdId,
        entityId,
        technologyId,
        status: PROJECT_STATUS.ACTIVE,
        progress: 0,
        assignedWorkers: 0,
        engineers: [
          { slot: 1, actorUuid: null },
          { slot: 2, actorUuid: null }
        ],
        weeklyRolls: {},
        startedWeek: envelope.researchState.currentWeek,
        completedWeek: null,
        paused: false
      });
    });
    return createdId;
  }

  async updateWorkers(projectId, assignedWorkers) {
    const workers = asInteger(assignedWorkers, -1);
    if (workers < 0 || Number(assignedWorkers) !== workers) throw new Error(localize("Errors.WorkerInteger"));
    return this.store.transaction("updateWorkers", envelope => {
      const project = requireActiveProject(envelope, projectId);
      project.assignedWorkers = workers;
    });
  }

  async assignEngineer(projectId, engineerSlot, actorUuid) {
    const slot = Number(engineerSlot);
    if (![1, 2].includes(slot)) throw new Error(localize("Errors.InvalidEngineerSlot"));
    return this.store.transaction("assignEngineer", envelope => {
      const project = requireActiveProject(envelope, projectId);
      const week = envelope.researchState.currentWeek;
      const existingRoll = project.weeklyRolls?.[week]?.[slot];
      const assignment = project.engineers.find(engineer => engineer.slot === slot);
      const nextUuid = asString(actorUuid) || null;
      if (existingRoll && assignment.actorUuid !== nextUuid) throw new Error(localize("Errors.EngineerAlreadyRolled"));
      if (nextUuid && envelope.researchState.projects.some(candidate => candidate.status === PROJECT_STATUS.ACTIVE
        && candidate.engineers.some(engineer => engineer.actorUuid === nextUuid
          && (candidate.id !== project.id || engineer.slot !== slot)))) {
        throw new Error(localize("Errors.EngineerAlreadyAssigned"));
      }
      assignment.actorUuid = nextUuid;
    });
  }

  async setPaused(projectId, paused) {
    return this.store.transaction("pauseProject", envelope => {
      const project = requireActiveProject(envelope, projectId);
      project.paused = Boolean(paused);
    });
  }

  async cancel(projectId) {
    return this.store.transaction("cancelProject", envelope => {
      const project = requireActiveProject(envelope, projectId);
      project.status = PROJECT_STATUS.CANCELLED;
      project.paused = false;
      deactivateProjectModifiers(envelope, project.id, project.entityId);
    });
  }

  async adjustProgress(projectId, adjustment, { absolute = false } = {}) {
    const value = asInteger(adjustment, NaN);
    if (!Number.isFinite(value)) throw new Error(localize("Errors.InvalidProgress"));
    let completion = null;
    await this.store.transaction("adjustProgress", envelope => {
      const project = requireActiveProject(envelope, projectId);
      project.progress = Math.max(0, absolute ? value : project.progress + value);
      const technology = envelope.catalog.technologies.find(item => item.id === project.technologyId);
      const modifiers = activeModifiersFor(envelope.catalog, {
        week: envelope.researchState.currentWeek,
        entityId: project.entityId,
        technology,
        project
      });
      const cost = effectiveResearchCost(technology.researchPointCost, modifiers);
      if (project.progress >= cost) completion = completeProjectInEnvelope(envelope, project, technology, envelope.researchState.currentWeek);
    });
    return completion;
  }
}

export function requireActiveProject(envelope, projectId) {
  const project = envelope.researchState.projects.find(item => item.id === projectId);
  if (!project || project.status !== PROJECT_STATUS.ACTIVE) throw new Error(localize("Errors.ProjectNotActive"));
  return project;
}

export function completeProjectInEnvelope(envelope, project, technology, week) {
  project.status = PROJECT_STATUS.COMPLETED;
  project.paused = false;
  project.completedWeek = week;
  const completed = envelope.researchState.completedTechnologyIdsByEntity[project.entityId] ??= [];
  if (!completed.includes(technology.id)) completed.push(technology.id);

  for (const modifierId of technology.onComplete?.activateModifierIds ?? []) {
    const modifier = envelope.catalog.modifiers.find(item => item.id === modifierId && item.entityId === project.entityId);
    if (modifier) modifier.active = true;
  }
  for (const modifierId of technology.onComplete?.deactivateModifierIds ?? []) {
    const modifier = envelope.catalog.modifiers.find(item => item.id === modifierId && item.entityId === project.entityId);
    if (modifier) modifier.active = false;
  }
  deactivateProjectModifiers(envelope, project.id, project.entityId);
  return { projectId: project.id, technologyId: technology.id, entityId: project.entityId, week };
}

function deactivateProjectModifiers(envelope, projectId, entityId) {
  for (const modifier of envelope.catalog.modifiers) {
    if (modifier.entityId === entityId && modifier.scopeType === "project" && modifier.scopeId === projectId) {
      modifier.active = false;
    }
  }
}
