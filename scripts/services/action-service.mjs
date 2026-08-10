import {
  ENTITY_TYPES,
  MODIFIER_OPERATIONS,
  MODIFIER_SCOPES,
  MODIFIER_TARGETS,
  PROJECT_STATUS,
  RESULT_METHODS,
  ROLL_MODES,
  TECHNOLOGY_VISIBILITY,
  localize
} from "../constants.mjs";
import {
  normalizeCategory,
  normalizeEntity,
  normalizeModifier,
  normalizeModuleConfig,
  normalizeTechnology
} from "../store/schema.mjs";
import { requireGM, requireKnownUser } from "./permission-service.mjs";
import {
  asBoolean,
  asInteger,
  asNumber,
  asString,
  asText,
  createStableId,
  deepClone,
  parseJson,
  parseStringList,
  uniqueStrings
} from "../utils/validation.mjs";
import { createDemoEnvelopeData } from "./demo-data.mjs";
import { validateModuleConfig } from "./config-validation.mjs";

export const ACTIONS = Object.freeze({
  CREATE_DEMO: "createDemoData",
  CREATE_ENTITY: "createEntity",
  UPDATE_ENTITY: "updateEntity",
  DUPLICATE_ENTITY: "duplicateEntity",
  DELETE_ENTITY: "deleteEntity",
  REORDER_ENTITY: "reorderEntity",
  CREATE_CATEGORY: "createCategory",
  UPDATE_CATEGORY: "updateCategory",
  DUPLICATE_CATEGORY: "duplicateCategory",
  DELETE_CATEGORY: "deleteCategory",
  REORDER_CATEGORY: "reorderCategory",
  CREATE_TECHNOLOGY: "createTechnology",
  UPDATE_TECHNOLOGY: "updateTechnology",
  DUPLICATE_TECHNOLOGY: "duplicateTechnology",
  DELETE_TECHNOLOGY: "deleteTechnology",
  UPDATE_TECHNOLOGY_POSITION: "updateTechnologyPosition",
  CREATE_MODIFIER: "createModifier",
  UPDATE_MODIFIER: "updateModifier",
  DELETE_MODIFIER: "deleteModifier",
  START_RESEARCH: "startResearch",
  UPDATE_WORKERS: "updateWorkers",
  ASSIGN_ENGINEER: "assignEngineer",
  PAUSE_PROJECT: "pauseProject",
  CANCEL_PROJECT: "cancelProject",
  ADJUST_PROGRESS: "adjustProgress",
  SET_TECHNOLOGY_PROGRESS: "setTechnologyProgress",
  ROLL_ENGINEER: "rollEngineer",
  REROLL_ENGINEER: "rerollEngineer",
  ADVANCE_WEEK: "advanceWeek",
  RESET_WEEK: "resetWeek",
  UPDATE_CONFIG: "updateModuleConfig"
});

export const ACTION_ALLOWLIST = new Set(Object.values(ACTIONS));

export class ActionService {
  constructor({ store, projectService, rollService, weekService }) {
    this.store = store;
    this.projectService = projectService;
    this.rollService = rollService;
    this.weekService = weekService;
  }

  async handle(action, payload = {}, userId, meta = {}) {
    if (!ACTION_ALLOWLIST.has(action)) throw new Error(localize("Errors.UnsupportedAction", { action }));
    const user = requireKnownUser(userId);
    if (action === ACTIONS.ROLL_ENGINEER || action === ACTIONS.REROLL_ENGINEER) {
      if (action === ACTIONS.REROLL_ENGINEER) {
        return this.rollService.rerollEngineer({
          projectId: asString(payload.projectId),
          engineerSlot: Number(payload.engineerSlot),
          actorUuid: asString(payload.actorUuid),
          requesterUserId: user.id,
          requestId: asString(meta.requestId || payload.requestId),
          requestedWeek: Number(payload.currentWeek)
        });
      }
      return this.rollService.rollEngineer({
        projectId: asString(payload.projectId),
        engineerSlot: Number(payload.engineerSlot),
        actorUuid: asString(payload.actorUuid),
        requesterUserId: user.id,
        requestId: asString(meta.requestId || payload.requestId),
        requestedWeek: Number(payload.currentWeek),
        manualResult: payload.manualResult,
        automatic: Boolean(meta.automatic)
      });
    }

    requireGM(user);
    switch (action) {
      case ACTIONS.CREATE_DEMO: return this.#createDemoData();
      case ACTIONS.CREATE_ENTITY: return this.#createEntity(payload);
      case ACTIONS.UPDATE_ENTITY: return this.#updateEntity(payload);
      case ACTIONS.DUPLICATE_ENTITY: return this.#duplicateEntity(payload.entityId);
      case ACTIONS.DELETE_ENTITY: return this.#deleteEntity(payload.entityId);
      case ACTIONS.REORDER_ENTITY: return this.#reorderEntity(payload.entityId, payload.direction);
      case ACTIONS.CREATE_CATEGORY: return this.#createCategory(payload);
      case ACTIONS.UPDATE_CATEGORY: return this.#updateCategory(payload);
      case ACTIONS.DUPLICATE_CATEGORY: return this.#duplicateCategory(payload.categoryId, payload.entityId);
      case ACTIONS.DELETE_CATEGORY: return this.#deleteCategory(payload);
      case ACTIONS.REORDER_CATEGORY: return this.#reorderCategory(payload.entityId, payload.categoryId, payload.direction);
      case ACTIONS.CREATE_TECHNOLOGY: return this.#createTechnology(payload);
      case ACTIONS.UPDATE_TECHNOLOGY: return this.#updateTechnology(payload);
      case ACTIONS.DUPLICATE_TECHNOLOGY: return this.#duplicateTechnology(payload.technologyId);
      case ACTIONS.DELETE_TECHNOLOGY: return this.#deleteTechnology(payload.technologyId);
      case ACTIONS.UPDATE_TECHNOLOGY_POSITION: return this.#updateTechnologyPosition(payload);
      case ACTIONS.CREATE_MODIFIER: return this.#createModifier(payload);
      case ACTIONS.UPDATE_MODIFIER: return this.#updateModifier(payload);
      case ACTIONS.DELETE_MODIFIER: return this.#deleteModifier(payload.modifierId);
      case ACTIONS.START_RESEARCH: return this.projectService.start(asString(payload.entityId), asString(payload.technologyId));
      case ACTIONS.UPDATE_WORKERS: return this.projectService.updateWorkers(asString(payload.projectId), payload.assignedWorkers);
      case ACTIONS.ASSIGN_ENGINEER: return this.projectService.assignEngineer(asString(payload.projectId), payload.engineerSlot, payload.actorUuid);
      case ACTIONS.PAUSE_PROJECT: return this.projectService.setPaused(asString(payload.projectId), asBooleanValue(payload.paused));
      case ACTIONS.CANCEL_PROJECT: return this.projectService.cancel(asString(payload.projectId));
      case ACTIONS.ADJUST_PROGRESS: {
        const completion = await this.projectService.adjustProgress(asString(payload.projectId), payload.adjustment, { absolute: asBooleanValue(payload.absolute) });
        if (completion) await this.weekService.announceCompletions(completion);
        return completion;
      }
      case ACTIONS.SET_TECHNOLOGY_PROGRESS: {
        const result = await this.projectService.setTechnologyProgress(
          asString(payload.entityId),
          asString(payload.technologyId),
          payload.progress
        );
        if (result?.completion) await this.weekService.announceCompletions(result.completion);
        return result;
      }
      case ACTIONS.ADVANCE_WEEK: return this.weekService.advance({ missingRollPolicy: asString(payload.missingRollPolicy), requesterUserId: user.id });
      case ACTIONS.RESET_WEEK: return this.#resetWeek();
      case ACTIONS.UPDATE_CONFIG: return this.#updateConfig(payload);
      default: throw new Error(localize("Errors.UnsupportedAction", { action }));
    }
  }

  async #createDemoData() {
    let ids;
    await this.store.transaction("createDemoData", envelope => {
      if (envelope.catalog.entities.length || envelope.catalog.categories.length || envelope.catalog.technologies.length) {
        throw new Error(localize("Errors.DemoRequiresEmpty"));
      }
      const demo = createDemoEnvelopeData();
      envelope.catalog = demo.catalog;
      envelope.researchState = demo.researchState;
      ids = { entityId: demo.catalog.entities[0].id };
    });
    return ids;
  }

  async #createEntity(payload) {
    let id;
    await this.store.transaction("createEntity", envelope => {
      id = createStableId("entity");
      const entity = entityFromPayload(payload, { id, sortOrder: envelope.catalog.entities.length });
      envelope.catalog.entities.push(entity);
    });
    return { entityId: id };
  }

  async #updateEntity(payload) {
    const entityId = asString(payload.entityId ?? payload.id);
    await this.store.transaction("updateEntity", envelope => {
      const index = envelope.catalog.entities.findIndex(item => item.id === entityId);
      if (index < 0) throw new Error(localize("Errors.EntityNotFound"));
      const existing = envelope.catalog.entities[index];
      envelope.catalog.entities[index] = entityFromPayload(payload, existing);
    });
    return { entityId };
  }

  async #duplicateEntity(rawEntityId) {
    const entityId = asString(rawEntityId);
    let duplicateId;
    await this.store.transaction("duplicateEntity", envelope => {
      const source = envelope.catalog.entities.find(item => item.id === entityId);
      if (!source) throw new Error(localize("Errors.EntityNotFound"));
      duplicateId = createStableId("entity");
      const categoryIdMap = new Map();
      const modifierIdMap = new Map();
      const technologyIdMap = new Map();

      const sourceCategories = source.categoryIds
        .map(id => envelope.catalog.categories.find(item => item.id === id))
        .filter(Boolean);
      for (const category of sourceCategories) categoryIdMap.set(category.id, createStableId("category"));
      for (const modifier of envelope.catalog.modifiers.filter(item => item.entityId === source.id)) {
        modifierIdMap.set(modifier.id, createStableId("modifier"));
      }
      for (const technology of envelope.catalog.technologies.filter(item => item.entityId === source.id)) {
        technologyIdMap.set(technology.id, createStableId("technology"));
      }

      const duplicate = deepClone(source);
      duplicate.id = duplicateId;
      duplicate.name = `${source.name} ${localize("Common.CopySuffix")}`;
      duplicate.sortOrder = envelope.catalog.entities.length;
      duplicate.categoryIds = source.categoryIds.map(id => categoryIdMap.get(id)).filter(Boolean);
      duplicate.modifierIds = source.modifierIds.map(id => modifierIdMap.get(id)).filter(Boolean);
      envelope.catalog.entities.push(duplicate);

      for (const category of sourceCategories) {
        envelope.catalog.categories.push({
          ...deepClone(category),
          id: categoryIdMap.get(category.id),
          entityIds: [duplicateId]
        });
      }
      for (const modifier of envelope.catalog.modifiers.filter(item => item.entityId === source.id)) {
        envelope.catalog.modifiers.push({
          ...deepClone(modifier),
          id: modifierIdMap.get(modifier.id),
          entityId: duplicateId,
          active: modifier.scopeType === "project" ? false : modifier.active,
          scopeType: modifier.scopeType === "project" ? "all" : modifier.scopeType,
          scopeId: modifier.scopeType === "project" ? "" : remapScopeId(modifier, categoryIdMap, technologyIdMap)
        });
      }
      const sourceTechnologies = envelope.catalog.technologies.filter(item => item.entityId === source.id);
      for (const technology of sourceTechnologies) {
        envelope.catalog.technologies.push({
          ...deepClone(technology),
          id: technologyIdMap.get(technology.id),
          entityId: duplicateId,
          categoryId: categoryIdMap.get(technology.categoryId),
          prerequisiteIds: technology.prerequisiteIds.map(id => technologyIdMap.get(id)).filter(Boolean),
          activatedModifierIds: technology.activatedModifierIds.map(id => modifierIdMap.get(id)).filter(Boolean),
          onComplete: {
            activateModifierIds: technology.onComplete.activateModifierIds.map(id => modifierIdMap.get(id)).filter(Boolean),
            deactivateModifierIds: technology.onComplete.deactivateModifierIds.map(id => modifierIdMap.get(id)).filter(Boolean)
          }
        });
      }
    });
    return { entityId: duplicateId };
  }

  async #deleteEntity(rawEntityId) {
    const entityId = asString(rawEntityId);
    await this.store.transaction("deleteEntity", envelope => {
      if (!envelope.catalog.entities.some(item => item.id === entityId)) throw new Error(localize("Errors.EntityNotFound"));
      const technologyIds = new Set(envelope.catalog.technologies.filter(item => item.entityId === entityId).map(item => item.id));
      const modifierIds = new Set(envelope.catalog.modifiers.filter(item => item.entityId === entityId).map(item => item.id));
      envelope.catalog.entities = envelope.catalog.entities.filter(item => item.id !== entityId);
      envelope.catalog.technologies = envelope.catalog.technologies.filter(item => item.entityId !== entityId);
      envelope.catalog.modifiers = envelope.catalog.modifiers.filter(item => item.entityId !== entityId);
      for (const category of envelope.catalog.categories) category.entityIds = category.entityIds.filter(id => id !== entityId);
      envelope.catalog.categories = envelope.catalog.categories.filter(category => category.entityIds.length
        || envelope.catalog.technologies.some(technology => technology.categoryId === category.id));
      for (const technology of envelope.catalog.technologies) {
        technology.prerequisiteIds = technology.prerequisiteIds.filter(id => !technologyIds.has(id));
        technology.activatedModifierIds = technology.activatedModifierIds.filter(id => !modifierIds.has(id));
        technology.onComplete.activateModifierIds = technology.onComplete.activateModifierIds.filter(id => !modifierIds.has(id));
        technology.onComplete.deactivateModifierIds = technology.onComplete.deactivateModifierIds.filter(id => !modifierIds.has(id));
      }
      envelope.researchState.projects = envelope.researchState.projects.filter(project => project.entityId !== entityId);
      delete envelope.researchState.completedTechnologyIdsByEntity[entityId];
      resequence(envelope.catalog.entities);
    });
    return true;
  }

  async #reorderEntity(rawEntityId, direction) {
    const entityId = asString(rawEntityId);
    return this.store.transaction("reorderEntity", envelope => {
      const entity = envelope.catalog.entities.find(item => item.id === entityId);
      if (!entity) throw new Error(localize("Errors.EntityNotFound"));
      reorderArray(envelope.catalog.entities, entityId, direction, item => item.type === entity.type);
      resequence(envelope.catalog.entities);
    });
  }

  async #createCategory(payload) {
    const entityId = asString(payload.entityId);
    let id;
    await this.store.transaction("createCategory", envelope => {
      const entity = envelope.catalog.entities.find(item => item.id === entityId);
      if (!entity) throw new Error(localize("Errors.EntityNotFound"));
      id = createStableId("category");
      const entityIds = uniqueStrings(payload.entityIds);
      if (!entityIds.includes(entityId)) entityIds.push(entityId);
      const category = categoryFromPayload(payload, { id, entityIds, sortOrder: envelope.catalog.categories.length });
      envelope.catalog.categories.push(category);
      syncCategoryMembership(envelope, category);
    });
    return { categoryId: id };
  }

  async #updateCategory(payload) {
    const categoryId = asString(payload.categoryId ?? payload.id);
    await this.store.transaction("updateCategory", envelope => {
      const index = envelope.catalog.categories.findIndex(item => item.id === categoryId);
      if (index < 0) throw new Error(localize("Errors.CategoryNotFound"));
      const existing = envelope.catalog.categories[index];
      const requiredEntityIds = envelope.catalog.technologies
        .filter(technology => technology.categoryId === categoryId)
        .map(technology => technology.entityId);
      const requested = uniqueStrings(payload.entityIds);
      const entityIds = [...new Set([...requested, ...requiredEntityIds])];
      const category = categoryFromPayload(payload, { ...existing, entityIds });
      envelope.catalog.categories[index] = category;
      syncCategoryMembership(envelope, category);
    });
    return { categoryId };
  }

  async #duplicateCategory(rawCategoryId, rawEntityId) {
    const categoryId = asString(rawCategoryId);
    const entityId = asString(rawEntityId);
    let duplicateId;
    await this.store.transaction("duplicateCategory", envelope => {
      const source = envelope.catalog.categories.find(item => item.id === categoryId);
      const entity = envelope.catalog.entities.find(item => item.id === entityId);
      if (!source || !entity) throw new Error(localize("Errors.CategoryNotFound"));
      duplicateId = createStableId("category");
      envelope.catalog.categories.push({
        ...deepClone(source),
        id: duplicateId,
        name: `${source.name} ${localize("Common.CopySuffix")}`,
        entityIds: [entityId],
        sortOrder: envelope.catalog.categories.length
      });
      entity.categoryIds.push(duplicateId);

      const sourceTechnologies = envelope.catalog.technologies.filter(item => item.entityId === entityId && item.categoryId === categoryId);
      const idMap = new Map(sourceTechnologies.map(item => [item.id, createStableId("technology")]));
      for (const technology of sourceTechnologies) {
        envelope.catalog.technologies.push({
          ...deepClone(technology),
          id: idMap.get(technology.id),
          name: `${technology.name} ${localize("Common.CopySuffix")}`,
          categoryId: duplicateId,
          prerequisiteIds: technology.prerequisiteIds.map(id => idMap.get(id) ?? id)
        });
      }
    });
    return { categoryId: duplicateId };
  }

  async #deleteCategory(payload) {
    const categoryId = asString(payload.categoryId);
    const moveToCategoryId = asString(payload.moveToCategoryId);
    await this.store.transaction("deleteCategory", envelope => {
      if (!envelope.catalog.categories.some(item => item.id === categoryId)) throw new Error(localize("Errors.CategoryNotFound"));
      const movingTarget = moveToCategoryId ? envelope.catalog.categories.find(item => item.id === moveToCategoryId) : null;
      if (moveToCategoryId && (!movingTarget || moveToCategoryId === categoryId)) throw new Error(localize("Errors.MoveCategoryTarget"));
      const removedTechnologyIds = new Set();
      const affectedTechnologies = envelope.catalog.technologies.filter(technology => technology.categoryId === categoryId);
      if (movingTarget) {
        for (const entityId of new Set(affectedTechnologies.map(technology => technology.entityId))) {
          if (!movingTarget.entityIds.includes(entityId)) movingTarget.entityIds.push(entityId);
          const entity = envelope.catalog.entities.find(item => item.id === entityId);
          if (entity && !entity.categoryIds.includes(movingTarget.id)) entity.categoryIds.push(movingTarget.id);
        }
        for (const technology of affectedTechnologies) technology.categoryId = moveToCategoryId;
      } else {
        for (const technology of affectedTechnologies) removedTechnologyIds.add(technology.id);
      }
      envelope.catalog.technologies = envelope.catalog.technologies.filter(item => !removedTechnologyIds.has(item.id));
      envelope.catalog.categories = envelope.catalog.categories.filter(item => item.id !== categoryId);
      for (const entity of envelope.catalog.entities) entity.categoryIds = entity.categoryIds.filter(id => id !== categoryId);
      for (const technology of envelope.catalog.technologies) {
        technology.prerequisiteIds = technology.prerequisiteIds.filter(id => !removedTechnologyIds.has(id));
      }
      envelope.researchState.projects = envelope.researchState.projects.filter(project => !removedTechnologyIds.has(project.technologyId));
      for (const ids of Object.values(envelope.researchState.completedTechnologyIdsByEntity)) {
        for (let index = ids.length - 1; index >= 0; index -= 1) if (removedTechnologyIds.has(ids[index])) ids.splice(index, 1);
      }
      neutralizeInvalidModifierScopes(envelope);
    });
    return true;
  }

  async #reorderCategory(rawEntityId, rawCategoryId, direction) {
    const entityId = asString(rawEntityId);
    const categoryId = asString(rawCategoryId);
    return this.store.transaction("reorderCategory", envelope => {
      const entity = envelope.catalog.entities.find(item => item.id === entityId);
      if (!entity) throw new Error(localize("Errors.EntityNotFound"));
      reorderIds(entity.categoryIds, categoryId, direction);
    });
  }

  async #createTechnology(payload) {
    let id;
    await this.store.transaction("createTechnology", envelope => {
      id = createStableId("technology");
      const entity = envelope.catalog.entities.find(item => item.id === asString(payload.entityId));
      const technology = technologyFromPayload(payload, {
        id,
        sortOrder: envelope.catalog.technologies.length,
        researchSkill: entity?.researchSkill ?? "engineering",
        researchSkillName: entity?.researchSkillName ?? ""
      });
      assertTechnologyMembership(envelope, technology);
      envelope.catalog.technologies.push(technology);
      refreshModifierUnlockStates(envelope, technology.onComplete.activateModifierIds);
    });
    return { technologyId: id };
  }

  async #updateTechnology(payload) {
    const technologyId = asString(payload.technologyId ?? payload.id);
    await this.store.transaction("updateTechnology", envelope => {
      const index = envelope.catalog.technologies.findIndex(item => item.id === technologyId);
      if (index < 0) throw new Error(localize("Errors.TechnologyNotFound"));
      const previousUnlockIds = envelope.catalog.technologies[index].onComplete.activateModifierIds;
      const technology = technologyFromPayload(payload, envelope.catalog.technologies[index]);
      assertTechnologyMembership(envelope, technology);
      envelope.catalog.technologies[index] = technology;
      refreshModifierUnlockStates(envelope, technology.onComplete.activateModifierIds
        .filter(modifierId => !previousUnlockIds.includes(modifierId)));
    });
    return { technologyId };
  }

  async #duplicateTechnology(rawTechnologyId) {
    const technologyId = asString(rawTechnologyId);
    let duplicateId;
    await this.store.transaction("duplicateTechnology", envelope => {
      const source = envelope.catalog.technologies.find(item => item.id === technologyId);
      if (!source) throw new Error(localize("Errors.TechnologyNotFound"));
      duplicateId = createStableId("technology");
      envelope.catalog.technologies.push({
        ...deepClone(source),
        id: duplicateId,
        name: `${source.name} ${localize("Common.CopySuffix")}`,
        x: source.x + 40,
        y: source.y + 40,
        sortOrder: envelope.catalog.technologies.length
      });
    });
    return { technologyId: duplicateId };
  }

  async #deleteTechnology(rawTechnologyId) {
    const technologyId = asString(rawTechnologyId);
    await this.store.transaction("deleteTechnology", envelope => {
      if (!envelope.catalog.technologies.some(item => item.id === technologyId)) throw new Error(localize("Errors.TechnologyNotFound"));
      envelope.catalog.technologies = envelope.catalog.technologies.filter(item => item.id !== technologyId);
      for (const technology of envelope.catalog.technologies) technology.prerequisiteIds = technology.prerequisiteIds.filter(id => id !== technologyId);
      envelope.researchState.projects = envelope.researchState.projects.filter(project => project.technologyId !== technologyId);
      for (const ids of Object.values(envelope.researchState.completedTechnologyIdsByEntity)) {
        const index = ids.indexOf(technologyId);
        if (index >= 0) ids.splice(index, 1);
      }
      neutralizeInvalidModifierScopes(envelope);
    });
    return true;
  }

  async #updateTechnologyPosition(payload) {
    const technologyId = asString(payload.technologyId);
    const x = asNumber(payload.x, NaN);
    const y = asNumber(payload.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(localize("Errors.InvalidPosition"));
    return this.store.transaction("updateTechnologyPosition", envelope => {
      const technology = envelope.catalog.technologies.find(item => item.id === technologyId);
      if (!technology) throw new Error(localize("Errors.TechnologyNotFound"));
      technology.x = Math.round(x);
      technology.y = Math.round(y);
    });
  }

  async #createModifier(payload) {
    let id;
    await this.store.transaction("createModifier", envelope => {
      id = createStableId("modifier");
      const modifier = modifierFromPayload(payload, { id });
      assertModifierMembership(envelope, modifier);
      syncModifierUnlock(envelope, modifier, asString(payload.unlockTechnologyId));
      envelope.catalog.modifiers.push(modifier);
      const entity = envelope.catalog.entities.find(item => item.id === modifier.entityId);
      if (!entity.modifierIds.includes(id)) entity.modifierIds.push(id);
    });
    return { modifierId: id };
  }

  async #updateModifier(payload) {
    const modifierId = asString(payload.modifierId ?? payload.id);
    await this.store.transaction("updateModifier", envelope => {
      const index = envelope.catalog.modifiers.findIndex(item => item.id === modifierId);
      if (index < 0) throw new Error(localize("Errors.ModifierNotFound"));
      const existing = envelope.catalog.modifiers[index];
      const modifier = modifierFromPayload(payload, existing);
      assertModifierMembership(envelope, modifier);
      const existingUnlockTechnologyId = envelope.catalog.technologies.find(technology =>
        technology.onComplete.activateModifierIds.includes(modifierId))?.id ?? "";
      syncModifierUnlock(
        envelope,
        modifier,
        payload.unlockTechnologyId === undefined
          ? existingUnlockTechnologyId
          : asString(payload.unlockTechnologyId)
      );
      envelope.catalog.modifiers[index] = modifier;
      if (existing.entityId !== modifier.entityId) {
        const oldEntity = envelope.catalog.entities.find(item => item.id === existing.entityId);
        if (oldEntity) oldEntity.modifierIds = oldEntity.modifierIds.filter(id => id !== modifierId);
      }
      const entity = envelope.catalog.entities.find(item => item.id === modifier.entityId);
      if (!entity.modifierIds.includes(modifierId)) entity.modifierIds.push(modifierId);
    });
    return { modifierId };
  }

  async #deleteModifier(rawModifierId) {
    const modifierId = asString(rawModifierId);
    return this.store.transaction("deleteModifier", envelope => {
      if (!envelope.catalog.modifiers.some(item => item.id === modifierId)) throw new Error(localize("Errors.ModifierNotFound"));
      envelope.catalog.modifiers = envelope.catalog.modifiers.filter(item => item.id !== modifierId);
      for (const entity of envelope.catalog.entities) entity.modifierIds = entity.modifierIds.filter(id => id !== modifierId);
      for (const technology of envelope.catalog.technologies) {
        technology.activatedModifierIds = technology.activatedModifierIds.filter(id => id !== modifierId);
        technology.onComplete.activateModifierIds = technology.onComplete.activateModifierIds.filter(id => id !== modifierId);
        technology.onComplete.deactivateModifierIds = technology.onComplete.deactivateModifierIds.filter(id => id !== modifierId);
      }
    });
  }

  async #updateConfig(payload) {
    return this.store.transaction("updateModuleConfig", envelope => {
      let resultBands = payload.resultBands;
      if (resultBands === undefined) resultBands = envelope.moduleConfig.resultBands;
      if (typeof resultBands === "string") resultBands = parseJson(resultBands, localize("Config.ResultBands"));
      const normalized = normalizeModuleConfig({
        ...envelope.moduleConfig,
        rollMode: asString(payload.rollMode, envelope.moduleConfig.rollMode),
        engineeringFormula: asString(payload.engineeringFormula, envelope.moduleConfig.engineeringFormula),
        resultMethod: asString(payload.resultMethod, envelope.moduleConfig.resultMethod),
        resultBands,
        systemAdapterId: asString(payload.systemAdapterId),
        historyLimit: payload.historyLimit ?? envelope.moduleConfig.historyLimit
      });
      validateModuleConfig(normalized);
      envelope.moduleConfig = normalized;
      envelope.researchState.history = envelope.researchState.history.slice(-normalized.historyLimit);
    });
  }

  async #resetWeek() {
    return this.store.transaction("resetWeek", envelope => {
      envelope.researchState.currentWeek = 1;
      envelope.researchState.history = [];
      envelope.researchState.processedRequestIds = [];
      for (const project of envelope.researchState.projects) {
        if (project.status !== PROJECT_STATUS.ACTIVE) continue;
        project.weeklyRolls = {};
        project.startedWeek = 1;
      }
    });
  }
}

function entityFromPayload(payload, fallback) {
  const requestedName = asString(payload.name ?? fallback.name);
  if (!requestedName) throw new Error(localize("Errors.NameRequired"));
  const entity = normalizeEntity({
    ...fallback,
    name: requestedName,
    type: Object.values(ENTITY_TYPES).includes(payload.type) ? payload.type : fallback.type,
    icon: payload.icon ?? fallback.icon,
    banner: payload.banner ?? fallback.banner,
    description: payload.description ?? fallback.description,
    lore: payload.lore ?? fallback.lore,
    public: payload.public === undefined ? fallback.public : asBooleanValue(payload.public),
    allowedUserIds: payload.allowedUserIds === undefined ? fallback.allowedUserIds : uniqueStrings(payload.allowedUserIds),
    researchSkill: payload.researchSkill ?? fallback.researchSkill,
    researchSkillName: payload.researchSkillName ?? fallback.researchSkillName,
    rpOnSuccess: payload.rpOnSuccess ?? fallback.rpOnSuccess,
    rpPerRaise: payload.rpPerRaise ?? fallback.rpPerRaise,
    basePointsPerWorker: payload.basePointsPerWorker ?? fallback.basePointsPerWorker,
    maxConcurrentProjects: payload.maxConcurrentProjects ?? fallback.maxConcurrentProjects
  });
  assertSafePath(entity.icon);
  assertSafePath(entity.banner);
  return entity;
}

function categoryFromPayload(payload, fallback) {
  const requestedName = asString(payload.name ?? fallback.name);
  if (!requestedName) throw new Error(localize("Errors.NameRequired"));
  const category = normalizeCategory({
    ...fallback,
    name: requestedName,
    icon: payload.icon ?? fallback.icon,
    description: payload.description ?? fallback.description,
    entityIds: payload.entityIds ?? fallback.entityIds
  });
  assertSafePath(category.icon);
  return category;
}

function technologyFromPayload(payload, fallback) {
  const requestedName = asString(payload.name ?? fallback.name);
  if (!requestedName) throw new Error(localize("Errors.NameRequired"));
  const technology = normalizeTechnology({
    ...fallback,
    entityId: payload.entityId ?? fallback.entityId,
    categoryId: payload.categoryId ?? fallback.categoryId,
    name: requestedName,
    icon: payload.icon ?? fallback.icon,
    description: payload.description ?? fallback.description,
    researchSkill: payload.researchSkill ?? fallback.researchSkill,
    researchSkillName: payload.researchSkillName ?? fallback.researchSkillName,
    researchPointCost: payload.researchPointCost ?? fallback.researchPointCost,
    x: payload.x ?? fallback.x,
    y: payload.y ?? fallback.y,
    prerequisiteIds: payload.prerequisiteIds === undefined ? fallback.prerequisiteIds : uniqueStrings(payload.prerequisiteIds),
    tags: payload.tags === undefined ? fallback.tags : parseStringList(payload.tags),
    visibility: Object.values(TECHNOLOGY_VISIBILITY).includes(payload.visibility) ? payload.visibility : fallback.visibility,
    repeatable: payload.repeatable === undefined ? fallback.repeatable : asBooleanValue(payload.repeatable),
    activatedModifierIds: payload.activatedModifierIds === undefined ? fallback.activatedModifierIds : uniqueStrings(payload.activatedModifierIds),
    onComplete: {
      activateModifierIds: payload.activateModifierIds === undefined ? fallback.onComplete?.activateModifierIds : uniqueStrings(payload.activateModifierIds),
      deactivateModifierIds: payload.deactivateModifierIds === undefined ? fallback.onComplete?.deactivateModifierIds : uniqueStrings(payload.deactivateModifierIds)
    },
    sortOrder: payload.sortOrder ?? fallback.sortOrder
  });
  if (technology.researchPointCost < 1) throw new Error(localize("Errors.InvalidCost"));
  assertSafePath(technology.icon);
  return technology;
}

function modifierFromPayload(payload, fallback) {
  const requestedName = asString(payload.name ?? fallback.name);
  if (!requestedName) throw new Error(localize("Errors.NameRequired"));
  const modifier = normalizeModifier({
    ...fallback,
    entityId: payload.entityId ?? fallback.entityId,
    name: requestedName,
    description: payload.description ?? fallback.description,
    active: payload.active === undefined ? fallback.active : asBooleanValue(payload.active),
    source: payload.source ?? fallback.source,
    operation: Object.values(MODIFIER_OPERATIONS).includes(payload.operation) ? payload.operation : fallback.operation,
    target: Object.values(MODIFIER_TARGETS).includes(payload.target) ? payload.target : fallback.target,
    scopeType: Object.values(MODIFIER_SCOPES).includes(payload.scopeType) ? payload.scopeType : fallback.scopeType,
    scopeId: payload.scopeId ?? fallback.scopeId,
    value: payload.value ?? fallback.value,
    startWeek: payload.startWeek ?? fallback.startWeek,
    endWeek: payload.endWeek ?? fallback.endWeek
  });
  if (modifier.startWeek !== null && modifier.endWeek !== null && modifier.endWeek < modifier.startWeek) {
    throw new Error(localize("Errors.ModifierDates"));
  }
  return modifier;
}

function assertTechnologyMembership(envelope, technology) {
  const entity = envelope.catalog.entities.find(item => item.id === technology.entityId);
  const category = envelope.catalog.categories.find(item => item.id === technology.categoryId);
  if (!entity || !category || !entity.categoryIds.includes(category.id) || !category.entityIds.includes(entity.id)) {
    throw new Error(localize("Errors.TechnologyMembership"));
  }
}

function assertModifierMembership(envelope, modifier) {
  const entity = envelope.catalog.entities.find(item => item.id === modifier.entityId);
  if (!entity) throw new Error(localize("Errors.EntityNotFound"));
  if (modifier.scopeType === "category" && !entity.categoryIds.includes(modifier.scopeId)) throw new Error(localize("Errors.ModifierScope"));
  if (modifier.scopeType === "technology" && !envelope.catalog.technologies.some(item => item.id === modifier.scopeId && item.entityId === entity.id)) throw new Error(localize("Errors.ModifierScope"));
  if (modifier.scopeType === "project" && !envelope.researchState.projects.some(item => item.id === modifier.scopeId && item.entityId === entity.id)) throw new Error(localize("Errors.ModifierScope"));
  if (modifier.scopeType !== "all" && !modifier.scopeId) throw new Error(localize("Errors.ModifierScope"));
}

function syncModifierUnlock(envelope, modifier, technologyId) {
  for (const technology of envelope.catalog.technologies) {
    technology.onComplete.activateModifierIds = technology.onComplete.activateModifierIds
      .filter(modifierId => modifierId !== modifier.id);
  }
  if (!technologyId) return;
  const technology = envelope.catalog.technologies.find(item => item.id === technologyId
    && item.entityId === modifier.entityId);
  if (!technology) throw new Error(localize("Errors.ModifierUnlockTechnology"));
  technology.onComplete.activateModifierIds.push(modifier.id);
  technology.onComplete.deactivateModifierIds = technology.onComplete.deactivateModifierIds
    .filter(modifierId => modifierId !== modifier.id);
  modifier.active = (envelope.researchState.completedTechnologyIdsByEntity[modifier.entityId] ?? [])
    .includes(technology.id);
}

function refreshModifierUnlockStates(envelope, modifierIds) {
  for (const modifierId of uniqueStrings(modifierIds)) {
    const modifier = envelope.catalog.modifiers.find(item => item.id === modifierId);
    if (!modifier) continue;
    const unlockTechnologies = envelope.catalog.technologies.filter(technology =>
      technology.entityId === modifier.entityId
      && technology.onComplete.activateModifierIds.includes(modifierId));
    if (!unlockTechnologies.length) continue;
    const completed = new Set(envelope.researchState.completedTechnologyIdsByEntity[modifier.entityId] ?? []);
    modifier.active = unlockTechnologies.some(technology => completed.has(technology.id));
  }
}

function syncCategoryMembership(envelope, category) {
  const allowed = new Set(category.entityIds);
  for (const entity of envelope.catalog.entities) {
    const has = entity.categoryIds.includes(category.id);
    if (allowed.has(entity.id) && !has) entity.categoryIds.push(category.id);
    if (!allowed.has(entity.id) && has) entity.categoryIds = entity.categoryIds.filter(id => id !== category.id);
  }
}

function neutralizeInvalidModifierScopes(envelope) {
  const categoryById = new Map(envelope.catalog.categories.map(category => [category.id, category]));
  const technologyById = new Map(envelope.catalog.technologies.map(technology => [technology.id, technology]));
  const projectById = new Map(envelope.researchState.projects.map(project => [project.id, project]));
  for (const modifier of envelope.catalog.modifiers) {
    const valid = modifier.scopeType === "all"
      || modifier.scopeType === "tag"
      || (modifier.scopeType === "category" && categoryById.get(modifier.scopeId)?.entityIds.includes(modifier.entityId))
      || (modifier.scopeType === "technology" && technologyById.get(modifier.scopeId)?.entityId === modifier.entityId)
      || (modifier.scopeType === "project" && projectById.get(modifier.scopeId)?.entityId === modifier.entityId);
    if (valid) continue;
    modifier.scopeType = "all";
    modifier.scopeId = "";
    modifier.active = false;
  }
}

function remapScopeId(modifier, categoryMap, technologyMap) {
  if (modifier.scopeType === "category") return categoryMap.get(modifier.scopeId) ?? "";
  if (modifier.scopeType === "technology") return technologyMap.get(modifier.scopeId) ?? "";
  if (modifier.scopeType === "project") return "";
  return modifier.scopeId;
}

function reorderArray(items, id, direction, predicate = () => true) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) throw new Error(localize("Errors.RecordNotFound"));
  const eligibleIndexes = items.map((item, itemIndex) => predicate(item) ? itemIndex : -1).filter(itemIndex => itemIndex >= 0);
  const eligiblePosition = eligibleIndexes.indexOf(index);
  const targetPosition = direction === "up" ? eligiblePosition - 1 : eligiblePosition + 1;
  if (eligiblePosition < 0 || targetPosition < 0 || targetPosition >= eligibleIndexes.length) return;
  const target = eligibleIndexes[targetPosition];
  [items[index], items[target]] = [items[target], items[index]];
}

function reorderIds(ids, id, direction) {
  const index = ids.indexOf(id);
  if (index < 0) throw new Error(localize("Errors.CategoryNotFound"));
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
}

function resequence(items) {
  items.forEach((item, index) => { item.sortOrder = index; });
}

function assertSafePath(path) {
  if (String(path ?? "").trim().toLowerCase().startsWith("data:")) throw new Error(localize("Errors.EmbeddedImage"));
}

function asBooleanValue(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "on", "yes"].includes(String(value ?? "").toLowerCase());
}
