import {
  DEFAULT_ENTITY_ICON,
  DEFAULT_TECH_ICON,
  ENTITY_TYPES,
  LIMITS,
  MODIFIER_SCOPES,
  PROJECT_STATUS,
  ROLL_MODES,
  TECHNOLOGY_STATUS,
  TECHNOLOGY_VISIBILITY,
  localize
} from "../constants.mjs";
import {
  getProjectForTechnology,
  getTechnologyStatus,
  prerequisitesMet,
  sortByOrderThenName,
  unlockedTechnologyIds
} from "../utils/graph-utils.mjs";
import {
  activeModifiersFor,
  calculateWeeklyResearch,
  effectiveResearchCost,
  isModifierActive,
  modifierIsBuff,
  modifierMagnitudeText
} from "../services/modifier-service.mjs";
import {
  canViewEntity,
  canViewTechnology,
  resolveActor,
  userOwnsActor,
  usersArray
} from "../services/permission-service.mjs";
import { isResponsibleGM } from "../store/research-store.mjs";

const STATUS_ICONS = Object.freeze({
  [TECHNOLOGY_STATUS.HIDDEN]: "fa-solid fa-eye-slash",
  [TECHNOLOGY_STATUS.LOCKED]: "fa-solid fa-lock",
  [TECHNOLOGY_STATUS.AVAILABLE]: "fa-solid fa-flask",
  [TECHNOLOGY_STATUS.IN_PROGRESS]: "fa-solid fa-gears",
  [TECHNOLOGY_STATUS.COMPLETED]: "fa-solid fa-circle-check"
});

export async function buildResearchContext({ store, uiState, weekService }) {
  const envelope = store.snapshot();
  const { catalog, researchState, moduleConfig } = envelope;
  const user = game.user;
  const locale = game.i18n?.lang ?? "en";
  const allEntities = sortByOrderThenName(catalog.entities, locale);
  const visibleEntities = allEntities.filter(entity => canViewEntity(user, entity));
  const selectedEntity = visibleEntities.find(entity => entity.id === uiState.selectedEntityId) ?? visibleEntities[0] ?? null;
  uiState.selectedEntityId = selectedEntity?.id ?? "";

  const searchQuery = String(uiState.searchQuery ?? "").trim().toLocaleLowerCase(locale);
  const entityContexts = visibleEntities.map(entity => {
    const context = entityListContext(entity, catalog, researchState);
    context.hidden = Boolean(searchQuery && !context.searchText.includes(searchQuery));
    return context;
  });
  const countries = entityContexts.filter(entity => entity.type === ENTITY_TYPES.COUNTRY);
  const facilities = entityContexts.filter(entity => entity.type === ENTITY_TYPES.FACILITY);
  const categories = selectedEntity ? categoriesForEntity(selectedEntity, catalog, locale) : [];
  const requestedTab = selectedEntity ? (uiState.activeTabByEntity[selectedEntity.id] ?? "overview") : "overview";
  const activeTab = requestedTab === "overview" || categories.some(category => category.id === requestedTab)
    ? requestedTab : "overview";
  if (selectedEntity) uiState.activeTabByEntity[selectedEntity.id] = activeTab;
  const isOverview = activeTab === "overview";
  const activeCategory = categories.find(category => category.id === activeTab) ?? null;
  const currentView = getTreeView(uiState, selectedEntity?.id, activeCategory?.id);

  const tree = activeCategory
    ? buildTreeContext({ catalog, researchState, selectedEntity, activeCategory, user, currentView })
    : null;
  if (tree && !tree.technologies.some(technology => technology.id === uiState.selectedTechnologyId)) {
    uiState.selectedTechnologyId = "";
  }
  const selectedTechnology = tree?.technologies.find(technology => technology.id === uiState.selectedTechnologyId) ?? null;
  if (tree) tree.technologies.forEach(technology => { technology.selected = technology.id === uiState.selectedTechnologyId; });
  const details = selectedTechnology
    ? await buildTechnologyDetails({
      technologyId: selectedTechnology.id,
      catalog,
      researchState,
      moduleConfig,
      entity: selectedEntity,
      user
    })
    : null;
  const overview = selectedEntity
    ? buildOverviewContext(selectedEntity, catalog, researchState, user)
    : null;
  const editor = await buildEditorContext({
    editorState: uiState.editor,
    selectedEntity,
    activeCategory,
    catalog,
    researchState,
    moduleConfig,
    weekService
  });

  return {
    moduleTitle: localize("App.Title"),
    isGM: Boolean(user?.isGM),
    canImport: Boolean(user?.isGM && isResponsibleGM()),
    editMode: Boolean(user?.isGM && uiState.editMode),
    currentWeek: researchState.currentWeek,
    zoomPercent: Math.round(currentView.zoom * 100),
    countries,
    facilities,
    hasVisibleEntities: visibleEntities.length > 0,
    hasAnyEntities: allEntities.length > 0,
    noAccess: allEntities.length > 0 && visibleEntities.length === 0,
    selectedEntity: selectedEntity ? {
      ...entityListContext(selectedEntity, catalog, researchState),
      description: selectedEntity.description,
      lore: selectedEntity.lore,
      banner: selectedEntity.banner
    } : null,
    categories: categories.map(category => ({ ...category, selected: category.id === activeTab })),
    activeTab,
    isOverview,
    activeCategory,
    overview,
    tree,
    details,
    editor,
    config: moduleConfig,
    rollModeManual: moduleConfig.rollMode === ROLL_MODES.MANUAL,
    defaultEntityIcon: DEFAULT_ENTITY_ICON,
    defaultTechIcon: DEFAULT_TECH_ICON,
    searchQuery: uiState.searchQuery ?? "",
    fullscreen: Boolean(uiState.fullscreen)
  };
}

function entityListContext(entity, catalog, state) {
  const technologyIds = new Set(catalog.technologies.filter(technology => technology.entityId === entity.id).map(item => item.id));
  const completed = (state.completedTechnologyIdsByEntity[entity.id] ?? []).filter(id => technologyIds.has(id)).length;
  const active = state.projects.filter(project => project.entityId === entity.id && project.status === PROJECT_STATUS.ACTIVE).length;
  return {
    ...entity,
    searchText: `${entity.name} ${entity.type}`.toLocaleLowerCase(game.i18n?.lang ?? "en"),
    typeLabel: localize(entity.type === ENTITY_TYPES.FACILITY ? "Entity.Type.Facility" : "Entity.Type.Country"),
    activeProjectCount: active,
    completedTechnologyCount: completed
  };
}

function categoriesForEntity(entity, catalog, locale) {
  const map = new Map(catalog.categories.map(category => [category.id, category]));
  const ordered = entity.categoryIds.map(id => map.get(id)).filter(Boolean);
  const extras = catalog.categories.filter(category => category.entityIds.includes(entity.id) && !entity.categoryIds.includes(category.id));
  return [...ordered, ...sortByOrderThenName(extras, locale)];
}

function buildTreeContext({ catalog, researchState, selectedEntity, activeCategory, user, currentView }) {
  const allForEntity = catalog.technologies.filter(technology => technology.entityId === selectedEntity.id);
  const visibleForEntity = allForEntity.filter(technology => canViewTechnology(user, selectedEntity, technology, researchState));
  const visibleForEntityById = new Map(visibleForEntity.map(technology => [technology.id, technology]));
  const categoryTechnologies = allForEntity.filter(technology => technology.categoryId === activeCategory.id);
  const visible = categoryTechnologies.filter(technology => visibleForEntityById.has(technology.id));
  const nodes = visible.map(technology => {
    const trueStatus = getTechnologyStatus(technology, researchState, { isGM: user.isGM });
    const status = user.isGM
      && technology.visibility === TECHNOLOGY_VISIBILITY.HIDDEN
      && ![TECHNOLOGY_STATUS.COMPLETED, TECHNOLOGY_STATUS.IN_PROGRESS].includes(trueStatus)
      ? TECHNOLOGY_STATUS.HIDDEN : trueStatus;
    const project = getProjectForTechnology(researchState, technology.entityId, technology.id);
    const progress = project?.progress ?? (trueStatus === TECHNOLOGY_STATUS.COMPLETED ? technology.researchPointCost : 0);
    const percent = Math.max(0, Math.min(100, Math.round((progress / Math.max(1, technology.researchPointCost)) * 100)));
    return {
      ...technology,
      status,
      statusLabel: statusLabel(status),
      statusIcon: STATUS_ICONS[status],
      selected: false,
      progress,
      progressPercent: percent,
      paused: Boolean(project?.paused),
      style: `left:${technology.x}px;top:${technology.y}px;`,
      searchText: `${technology.name} ${(technology.tags ?? []).join(" ")}`.toLocaleLowerCase(game.i18n?.lang ?? "en")
    };
  });
  const visibleIds = new Set(nodes.map(node => node.id));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const connections = [];
  for (const node of nodes) {
    let externalIndex = 0;
    for (const prerequisiteId of node.prerequisiteIds) {
      if (!visibleIds.has(prerequisiteId)) {
        const source = visibleForEntityById.get(prerequisiteId);
        if (!source) continue;
        const sourceCategory = catalog.categories.find(category => category.id === source.categoryId);
        const offset = externalIndex * 12;
        externalIndex += 1;
        connections.push({
          id: `${prerequisiteId}-${node.id}-external`,
          fromId: prerequisiteId,
          toId: node.id,
          x1: Math.max(0, node.x - 54),
          y1: node.y + LIMITS.NODE_HEIGHT / 2 + offset,
          x2: node.x + LIMITS.NODE_WIDTH / 2,
          y2: node.y + LIMITS.NODE_HEIGHT / 2,
          external: true,
          externalOffset: offset,
          externalTitle: localize("Tree.CrossCategoryPrerequisite", {
            technology: source.name,
            category: sourceCategory?.name ?? source.categoryId
          }),
          completed: node.status === TECHNOLOGY_STATUS.COMPLETED,
          locked: node.status === TECHNOLOGY_STATUS.LOCKED
        });
        continue;
      }
      const source = nodeById.get(prerequisiteId);
      connections.push({
        id: `${prerequisiteId}-${node.id}`,
        fromId: prerequisiteId,
        toId: node.id,
        x1: source.x + LIMITS.NODE_WIDTH / 2,
        y1: source.y + LIMITS.NODE_HEIGHT / 2,
        x2: node.x + LIMITS.NODE_WIDTH / 2,
        y2: node.y + LIMITS.NODE_HEIGHT / 2,
        completed: node.status === TECHNOLOGY_STATUS.COMPLETED,
        locked: node.status === TECHNOLOGY_STATUS.LOCKED
      });
    }
  }
  const maxX = Math.max(1200, ...nodes.map(node => node.x + LIMITS.NODE_WIDTH + LIMITS.TREE_PADDING));
  const maxY = Math.max(760, ...nodes.map(node => node.y + LIMITS.NODE_HEIGHT + LIMITS.TREE_PADDING));
  return {
    technologies: nodes,
    connections,
    empty: nodes.length === 0,
    width: maxX,
    height: maxY,
    transform: `translate(${currentView.panX}px, ${currentView.panY}px) scale(${currentView.zoom})`
  };
}

async function buildTechnologyDetails({ technologyId, catalog, researchState, moduleConfig, entity, user }) {
  const technology = catalog.technologies.find(item => item.id === technologyId);
  if (!technology || !canViewTechnology(user, entity, technology, researchState)) return null;
  const project = getProjectForTechnology(researchState, entity.id, technology.id);
  const status = getTechnologyStatus(technology, researchState, { isGM: user.isGM });
  const modifiers = activeModifiersFor(catalog, {
    week: researchState.currentWeek,
    entityId: entity.id,
    technology,
    project
  });
  const cost = effectiveResearchCost(technology.researchPointCost, modifiers);
  const progress = project?.progress ?? (status === TECHNOLOGY_STATUS.COMPLETED ? cost : 0);
  const prerequisiteIds = technology.prerequisiteIds;
  const unlockIds = unlockedTechnologyIds(technology.id, catalog.technologies.filter(item => item.entityId === entity.id));
  const safeTechnologyIds = new Set(catalog.technologies
    .filter(candidate => canViewTechnology(user, entity, candidate, researchState))
    .map(candidate => candidate.id));
  const actorChoices = [...(game.actors ?? [])].map(actor => ({ uuid: actor.uuid, name: actor.name }))
    .sort((left, right) => left.name.localeCompare(right.name, game.i18n?.lang ?? "en"));
  const engineers = project ? await Promise.all(project.engineers.map(async assignment => {
    const actor = await resolveActor(assignment.actorUuid);
    const roll = project.weeklyRolls?.[researchState.currentWeek]?.[assignment.slot] ?? null;
    const canRoll = Boolean(
      assignment.actorUuid
      && actor
      && project.status === PROJECT_STATUS.ACTIVE
      && !project.paused
      && !roll
      && userOwnsActor(user, actor)
      && (moduleConfig.rollMode !== ROLL_MODES.MANUAL || user.isGM)
    );
    return {
      ...assignment,
      actorName: actor?.name ?? (assignment.actorUuid ? localize("Project.MissingActor") : localize("Project.Unassigned")),
      actorImg: actor?.img ?? DEFAULT_ENTITY_ICON,
      missing: Boolean(assignment.actorUuid && !actor),
      roll,
      canRoll,
      canManage: Boolean(user.isGM),
      projectId: project.id,
      currentWeek: researchState.currentWeek,
      actorChoices: actorChoices.map(choice => ({ ...choice, selected: choice.uuid === assignment.actorUuid }))
    };
  })) : [];
  const rollPoints = engineers.map(engineer => engineer.roll?.points ?? 0);
  const forecast = project ? calculateWeeklyResearch({
    workers: project.assignedWorkers,
    basePointsPerWorker: entity.basePointsPerWorker,
    engineerPoints: rollPoints,
    modifiers
  }) : null;
  const remaining = Math.max(0, cost - progress);
  const estimatedWeeks = forecast?.weeklyTotal > 0 ? Math.ceil(remaining / forecast.weeklyTotal) : null;
  const activeProjectCount = researchState.projects.filter(item => item.entityId === entity.id && item.status === PROJECT_STATUS.ACTIVE).length;
  const canStart = Boolean(user.isGM
    && !project
    && (status !== TECHNOLOGY_STATUS.COMPLETED || technology.repeatable)
    && prerequisitesMet(technology, researchState)
    && activeProjectCount < entity.maxConcurrentProjects);

  return {
    ...technology,
    status,
    statusLabel: statusLabel(status),
    statusIcon: STATUS_ICONS[status],
    cost,
    baseCost: technology.researchPointCost,
    costModified: cost !== technology.researchPointCost,
    progress,
    progressPercent: Math.max(0, Math.min(100, Math.round((progress / Math.max(1, cost)) * 100))),
    prerequisites: prerequisiteIds.filter(id => safeTechnologyIds.has(id)).map(id => catalog.technologies.find(item => item.id === id)).filter(Boolean),
    unlocks: unlockIds.filter(id => safeTechnologyIds.has(id)).map(id => catalog.technologies.find(item => item.id === id)).filter(Boolean),
    modifiers: modifiers.map(modifierContext),
    project: project ? {
      ...project,
      engineers,
      estimatedWeeks,
      estimatedWeeksLabel: estimatedWeeks === null ? localize("Common.NotAvailable") : String(estimatedWeeks),
      currentWeek: researchState.currentWeek,
      pausedLabel: project.paused ? localize("Project.Paused") : ""
    } : null,
    actorChoices,
    canStart,
    startBlockedReason: canStart ? "" : startBlockedReason({ user, project, status, technology, researchState, entity, activeProjectCount })
  };
}

function buildOverviewContext(entity, catalog, state, user) {
  const week = state.currentWeek;
  const modifiers = catalog.modifiers.filter(modifier => modifier.entityId === entity.id
    && modifier.active
    && (modifier.scopeType !== MODIFIER_SCOPES.PROJECT
      || state.projects.some(project => project.id === modifier.scopeId && project.status === PROJECT_STATUS.ACTIVE))
    && (modifier.startWeek === null || week >= modifier.startWeek)
    && (modifier.endWeek === null || week <= modifier.endWeek));
  const projects = state.projects.filter(project => {
    if (project.entityId !== entity.id || project.status !== PROJECT_STATUS.ACTIVE) return false;
    const technology = catalog.technologies.find(item => item.id === project.technologyId);
    return canViewTechnology(user, entity, technology, state);
  })
    .map(project => ({
      ...project,
      technologyName: catalog.technologies.find(item => item.id === project.technologyId)?.name ?? project.technologyId,
      categoryId: catalog.technologies.find(item => item.id === project.technologyId)?.categoryId ?? ""
    }));
  const completedCount = (state.completedTechnologyIdsByEntity[entity.id] ?? []).length;
  const categoryById = new Map(catalog.categories.map(category => [category.id, category]));
  const strengthIds = new Set(modifiers.filter(modifier => modifier.scopeType === MODIFIER_SCOPES.CATEGORY && modifierIsBuff(modifier)).map(modifier => modifier.scopeId));
  const weaknessIds = new Set(modifiers.filter(modifier => modifier.scopeType === MODIFIER_SCOPES.CATEGORY && !modifierIsBuff(modifier)).map(modifier => modifier.scopeId));
  const history = [...state.history].reverse().map(entry => {
    const entitySummary = entry.entities?.find(item => item.entityId === entity.id);
    if (!entitySummary) return null;
    return {
      week: entry.week,
      projectCount: entitySummary.projectResults?.length ?? 0,
      totalPoints: (entitySummary.projectResults ?? []).reduce((sum, result) => sum + (Number(result.weeklyTotal) || 0), 0),
      completedCount: entitySummary.completedTechnologyIds?.length ?? 0
    };
  }).filter(Boolean).slice(0, 8);
  return {
    modifiers: modifiers.map(modifierContext),
    buffs: modifiers.filter(modifierIsBuff).map(modifierContext),
    debuffs: modifiers.filter(modifier => !modifierIsBuff(modifier)).map(modifierContext),
    projects,
    completedCount,
    capacityText: `${projects.length} / ${entity.maxConcurrentProjects}`,
    strengths: [...strengthIds].map(id => categoryById.get(id)).filter(Boolean),
    weaknesses: [...weaknessIds].map(id => categoryById.get(id)).filter(Boolean),
    history,
    previousWeek: history.find(entry => entry.week === week - 1) ?? null
  };
}

async function buildEditorContext({ editorState, selectedEntity, activeCategory, catalog, researchState, moduleConfig, weekService }) {
  if (!editorState) return null;
  const type = editorState.type;
  const base = { ...editorState, type };
  if (type === "entity") {
    const entity = catalog.entities.find(item => item.id === editorState.id) ?? {
      id: "", type: editorState.entityType ?? ENTITY_TYPES.COUNTRY, name: "", icon: DEFAULT_ENTITY_ICON,
      banner: "", description: "", lore: "", public: true, allowedUserIds: [], basePointsPerWorker: 1,
      maxConcurrentProjects: 2
    };
    return {
      ...base,
      title: localize(entity.id ? "Editor.Entity.EditTitle" : "Editor.Entity.CreateTitle"),
      action: entity.id ? "updateEntity" : "createEntity",
      entity,
      countrySelected: entity.type === ENTITY_TYPES.COUNTRY,
      facilitySelected: entity.type === ENTITY_TYPES.FACILITY,
      users: usersArray().filter(user => !user.isGM).map(user => ({ id: user.id, name: user.name, checked: entity.allowedUserIds.includes(user.id) }))
    };
  }
  if (type === "category") {
    const category = catalog.categories.find(item => item.id === editorState.id) ?? {
      id: "", name: "", icon: "fa-solid fa-diagram-project", description: "", entityIds: selectedEntity ? [selectedEntity.id] : []
    };
    return {
      ...base,
      title: localize(category.id ? "Editor.Category.EditTitle" : "Editor.Category.CreateTitle"),
      action: category.id ? "updateCategory" : "createCategory",
      category,
      selectedEntityId: selectedEntity?.id ?? "",
      entities: catalog.entities.map(entity => ({ ...entity, checked: category.entityIds.includes(entity.id) }))
    };
  }
  if (type === "technology") {
    const technology = catalog.technologies.find(item => item.id === editorState.id) ?? {
      id: "", entityId: selectedEntity?.id ?? "", categoryId: activeCategory?.id ?? selectedEntity?.categoryIds?.[0] ?? "",
      name: "", icon: DEFAULT_TECH_ICON, description: "", researchPointCost: 10, x: 100, y: 100,
      prerequisiteIds: [], tags: [], visibility: TECHNOLOGY_VISIBILITY.PUBLIC, repeatable: false,
      activatedModifierIds: [], onComplete: { activateModifierIds: [], deactivateModifierIds: [] }, sortOrder: 0
    };
    const entityId = technology.entityId || selectedEntity?.id;
    return {
      ...base,
      title: localize(technology.id ? "Editor.Technology.EditTitle" : "Editor.Technology.CreateTitle"),
      action: technology.id ? "updateTechnology" : "createTechnology",
      technology,
      tagsText: technology.tags.join(", "),
      categories: categoriesForEntity(catalog.entities.find(entity => entity.id === entityId) ?? selectedEntity, catalog, game.i18n?.lang ?? "en")
        .map(category => ({ ...category, selected: category.id === technology.categoryId })),
      prerequisites: catalog.technologies.filter(item => item.entityId === entityId && item.id !== technology.id)
        .map(item => ({ ...item, checked: technology.prerequisiteIds.includes(item.id) })),
      modifiers: catalog.modifiers.filter(item => item.entityId === entityId).map(item => ({
        ...item,
        activatedChecked: technology.activatedModifierIds.includes(item.id),
        activateChecked: technology.onComplete.activateModifierIds.includes(item.id),
        deactivateChecked: technology.onComplete.deactivateModifierIds.includes(item.id)
      })),
      publicSelected: technology.visibility === TECHNOLOGY_VISIBILITY.PUBLIC,
      hiddenSelected: technology.visibility === TECHNOLOGY_VISIBILITY.HIDDEN,
      secretSelected: technology.visibility === TECHNOLOGY_VISIBILITY.SECRET_UNTIL_AVAILABLE
    };
  }
  if (type === "modifier") {
    const modifier = catalog.modifiers.find(item => item.id === editorState.id) ?? {
      id: "", entityId: selectedEntity?.id ?? "", name: "", description: "", active: true, source: "",
      operation: "add", target: "weeklyTotal", scopeType: "all", scopeId: "", value: 0, startWeek: null, endWeek: null
    };
    const choices = [
      ...catalog.categories.filter(item => item.entityIds.includes(modifier.entityId)).map(item => ({ id: item.id, name: `${localize("Common.Category")}: ${item.name}` })),
      ...catalog.technologies.filter(item => item.entityId === modifier.entityId).map(item => ({ id: item.id, name: `${localize("Common.Technology")}: ${item.name}` })),
      ...researchState.projects.filter(item => item.entityId === modifier.entityId).map(item => ({ id: item.id, name: `${localize("Common.Project")}: ${catalog.technologies.find(tech => tech.id === item.technologyId)?.name ?? item.id}` }))
    ];
    return {
      ...base,
      title: localize(modifier.id ? "Editor.Modifier.EditTitle" : "Editor.Modifier.CreateTitle"),
      action: modifier.id ? "updateModifier" : "createModifier",
      modifier,
      scopeChoices: choices
    };
  }
  if (type === "deleteCategory") {
    const category = catalog.categories.find(item => item.id === editorState.id);
    return {
      ...base,
      title: localize("Editor.Category.DeleteTitle"),
      category,
      moveTargets: categoriesForEntity(selectedEntity, catalog, game.i18n?.lang ?? "en").filter(item => item.id !== category?.id),
      technologyCount: catalog.technologies.filter(item => item.categoryId === category?.id).length
    };
  }
  if (type === "config") {
    return {
      ...base,
      title: localize("Editor.Config.Title"),
      config: moduleConfig,
      resultBandsText: JSON.stringify(moduleConfig.resultBands, null, 2)
    };
  }
  if (type === "advanceWeek") {
    const missing = weekService.getMissingRolls({ catalog, researchState, moduleConfig });
    const rows = await Promise.all(missing.map(async item => {
      const project = researchState.projects.find(project => project.id === item.projectId);
      const technology = catalog.technologies.find(technology => technology.id === project?.technologyId);
      const actor = await resolveActor(item.actorUuid);
      return { ...item, technologyName: technology?.name ?? item.projectId, actorName: actor?.name ?? localize("Project.MissingActor") };
    }));
    return { ...base, title: localize("Advance.Title"), missing: rows, missingCount: rows.length };
  }
  if (type === "manualRoll") {
    return { ...base, title: localize("Roll.ManualTitle"), currentWeek: researchState.currentWeek };
  }
  return null;
}

function modifierContext(modifier) {
  const description = modifier.description || localize("Modifier.GeneratedDescription", {
    amount: modifierMagnitudeText(modifier),
    target: localize(`Modifier.Target.${modifier.target}`),
    scope: localize(`Modifier.Scope.${modifier.scopeType}`)
  });
  return {
    ...modifier,
    description,
    magnitude: modifierMagnitudeText(modifier),
    buff: modifierIsBuff(modifier),
    kindLabel: modifierIsBuff(modifier) ? localize("Modifier.Buff") : localize("Modifier.Debuff")
  };
}

function statusLabel(status) {
  const suffix = {
    [TECHNOLOGY_STATUS.HIDDEN]: "Hidden",
    [TECHNOLOGY_STATUS.LOCKED]: "Locked",
    [TECHNOLOGY_STATUS.AVAILABLE]: "Available",
    [TECHNOLOGY_STATUS.IN_PROGRESS]: "InProgress",
    [TECHNOLOGY_STATUS.COMPLETED]: "Completed"
  }[status] ?? "Locked";
  return localize(`Status.${suffix}`);
}

function startBlockedReason({ user, project, status, technology, researchState, entity, activeProjectCount }) {
  if (!user.isGM) return localize("Errors.GMOnly");
  if (project) return localize("Errors.ProjectAlreadyActive");
  if (status === TECHNOLOGY_STATUS.COMPLETED && !technology.repeatable) return localize("Errors.AlreadyCompleted");
  if (!prerequisitesMet(technology, researchState)) return localize("Errors.Prerequisites");
  if (activeProjectCount >= entity.maxConcurrentProjects) return localize("Errors.ProjectCapacity");
  return "";
}

function getTreeView(uiState, entityId, categoryId) {
  const key = entityId && categoryId ? `${entityId}:${categoryId}` : "";
  const stored = key ? uiState.viewByTree?.[key] : null;
  const zoom = Math.min(LIMITS.MAX_ZOOM, Math.max(LIMITS.MIN_ZOOM, Number(stored?.zoom) || 1));
  return {
    key,
    zoom,
    panX: Number.isFinite(Number(stored?.panX)) ? Number(stored.panX) : 24,
    panY: Number.isFinite(Number(stored?.panY)) ? Number(stored.panY) : 24
  };
}
