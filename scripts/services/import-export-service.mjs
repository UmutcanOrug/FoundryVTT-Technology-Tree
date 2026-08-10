import {
  LIMITS,
  MODULE_ID,
  MODULE_VERSION,
  SCHEMA_VERSION,
  localize
} from "../constants.mjs";
import { validateEnvelopeIntegrity } from "../store/integrity.mjs";
import { migrateWorldEnvelope } from "../store/migrations.mjs";
import { createStableId, deepClone, parseJson, slugForFilename } from "../utils/validation.mjs";
import { validateModuleConfig } from "./config-validation.mjs";
import { isResponsibleGM } from "../store/research-store.mjs";

export class ImportExportService {
  constructor(store) {
    this.store = store;
  }

  createExportEnvelope(snapshot = this.store.snapshot()) {
    return {
      format: MODULE_ID,
      exportType: "fullBackup",
      schemaVersion: SCHEMA_VERSION,
      moduleVersion: game.modules?.get?.(MODULE_ID)?.version ?? MODULE_VERSION,
      exportedAt: new Date().toISOString(),
      catalog: deepClone(snapshot.catalog),
      researchState: deepClone(snapshot.researchState),
      moduleConfig: deepClone(snapshot.moduleConfig)
    };
  }

  createTreeExportEnvelope(entityId, snapshot = this.store.snapshot()) {
    return buildTreeExportEnvelope(snapshot, entityId, {
      moduleVersion: game.modules?.get?.(MODULE_ID)?.version ?? MODULE_VERSION
    });
  }

  exportAll({ backup = false, snapshot = null } = {}) {
    if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
    const stamp = timestampForFilename();
    const filename = `${slugForFilename(MODULE_ID)}-${backup ? "backup" : "export"}-${stamp}.json`;
    downloadJson(this.createExportEnvelope(snapshot ?? this.store.snapshot()), filename);
    return filename;
  }

  exportTree(entityId, { snapshot = null } = {}) {
    if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
    const envelope = this.createTreeExportEnvelope(entityId, snapshot ?? this.store.snapshot());
    const entity = envelope.catalog.entities[0];
    const filename = `${slugForFilename(entity.name)}-tech-tree-${timestampForFilename()}.json`;
    downloadJson(envelope, filename);
    return { filename, entityName: entity.name };
  }

  async readFile(file) {
    if (!file) throw new Error(localize("Errors.ImportFileMissing"));
    if (Number(file.size) > LIMITS.MAX_IMPORT_BYTES) throw new Error(localize("Errors.ImportTooLarge"));
    const reader = globalThis.foundry?.utils?.readTextFromFile;
    return typeof reader === "function" ? reader(file) : file.text();
  }

  validateImportText(text) {
    const raw = parseJson(text, localize("Import.InvalidJson"));
    validateRawEnvelope(raw);
    const migrated = migrateWorldEnvelope({
      schemaVersion: raw.schemaVersion,
      catalog: raw.catalog,
      researchState: raw.researchState,
      moduleConfig: raw.moduleConfig
    });
    validateModuleConfig(migrated.moduleConfig);
    validateEnvelopeIntegrity(migrated);
    return migrated;
  }

  validateTreeImportText(text) {
    const migrated = this.validateImportText(text);
    if (migrated.catalog.entities.length !== 1) throw new Error(localize("Errors.ImportSingleTree"));
    return migrated;
  }

  async importText(text, options = {}) {
    return this.importTreeText(text, options);
  }

  async importTreeText(text, { confirm = true } = {}) {
    if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
    if (!isResponsibleGM()) throw new Error(localize("Errors.ActiveGMOnly"));
    const migrated = this.validateTreeImportText(text);
    const before = this.store.snapshot();
    this.exportAll({ backup: true, snapshot: before });
    if (confirm && !(await confirmTreeImport(migrated))) return false;
    let imported;
    await this.store.transaction("importTree", working => {
      if (JSON.stringify(working) !== JSON.stringify(before)) throw new Error(localize("Errors.ImportWorldChanged"));
      imported = mergeTreeIntoEnvelope(working, migrated);
      Object.assign(working, imported.envelope);
    });
    ui.notifications?.info?.(localize("Notifications.TreeImportComplete", { name: imported.entityName }));
    return { entityId: imported.entityId, entityName: imported.entityName };
  }

  async replaceAllText(text, { confirm = true } = {}) {
    if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
    if (!isResponsibleGM()) throw new Error(localize("Errors.ActiveGMOnly"));
    const migrated = this.validateImportText(text);
    const before = this.store.snapshot();
    this.exportAll({ backup: true, snapshot: before });
    if (confirm && !(await confirmFullRestore(migrated))) return false;
    await this.store.replaceAll(migrated, { reason: "import", expectedEnvelope: before });
    ui.notifications?.info?.(localize("Notifications.ImportComplete"));
    return true;
  }
}

export function buildTreeExportEnvelope(snapshot, entityId, { moduleVersion = MODULE_VERSION } = {}) {
  const entity = snapshot?.catalog?.entities?.find(item => item.id === entityId);
  if (!entity) throw new Error(localize("Errors.EntityNotFound"));
  const categoryIds = new Set(entity.categoryIds ?? []);
  const categories = (snapshot.catalog.categories ?? []).filter(category => categoryIds.has(category.id));
  if (categories.length !== categoryIds.size) throw new Error(localize("Errors.ProjectReferences"));
  const technologies = (snapshot.catalog.technologies ?? []).filter(technology => technology.entityId === entity.id);
  const modifiers = (snapshot.catalog.modifiers ?? []).filter(modifier => modifier.entityId === entity.id);
  return {
    format: MODULE_ID,
    exportType: "technologyTree",
    schemaVersion: SCHEMA_VERSION,
    moduleVersion,
    exportedAt: new Date().toISOString(),
    catalog: {
      entities: [{
        ...deepClone(entity),
        categoryIds: categories.map(category => category.id),
        modifierIds: modifiers.map(modifier => modifier.id)
      }],
      categories: categories.map(category => ({ ...deepClone(category), entityIds: [entity.id] })),
      technologies: deepClone(technologies),
      modifiers: modifiers.map(modifier => modifier.scopeType === "project"
        ? { ...deepClone(modifier), active: false, scopeType: "all", scopeId: "" }
        : deepClone(modifier))
    },
    researchState: {
      currentWeek: 1,
      projects: [],
      completedTechnologyIdsByEntity: {},
      history: [],
      processedRequestIds: []
    },
    moduleConfig: deepClone(snapshot.moduleConfig)
  };
}

export function mergeTreeIntoEnvelope(current, imported, { idFactory = createStableId } = {}) {
  if (imported?.catalog?.entities?.length !== 1) throw new Error(localize("Errors.ImportSingleTree"));
  const result = deepClone(current);
  const sourceEntity = imported.catalog.entities[0];
  const sourceCategories = sourceEntity.categoryIds
    .map(id => imported.catalog.categories.find(category => category.id === id))
    .filter(Boolean);
  const sourceTechnologies = imported.catalog.technologies.filter(technology => technology.entityId === sourceEntity.id);
  const sourceModifiers = imported.catalog.modifiers.filter(modifier => modifier.entityId === sourceEntity.id);
  if (sourceCategories.length !== sourceEntity.categoryIds.length) throw new Error(localize("Errors.ImportCatalog"));

  const occupiedIds = new Set([
    ...result.catalog.entities,
    ...result.catalog.categories,
    ...result.catalog.technologies,
    ...result.catalog.modifiers,
    ...result.researchState.projects
  ].map(item => item.id));
  const nextId = prefix => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = idFactory(prefix);
      if (candidate && !occupiedIds.has(candidate)) {
        occupiedIds.add(candidate);
        return candidate;
      }
    }
    throw new Error(localize("Errors.ImportId"));
  };

  const entityId = nextId("entity");
  const categoryIdMap = new Map(sourceCategories.map(category => [category.id, nextId("category")]));
  const technologyIdMap = new Map(sourceTechnologies.map(technology => [technology.id, nextId("technology")]));
  const modifierIdMap = new Map(sourceModifiers.map(modifier => [modifier.id, nextId("modifier")]));
  const entityName = uniqueImportedName(result.catalog.entities, sourceEntity.name);

  result.catalog.entities.push({
    ...deepClone(sourceEntity),
    id: entityId,
    name: entityName,
    categoryIds: sourceCategories.map(category => categoryIdMap.get(category.id)),
    modifierIds: sourceModifiers.map(modifier => modifierIdMap.get(modifier.id)),
    sortOrder: result.catalog.entities.length
  });
  for (const category of sourceCategories) {
    result.catalog.categories.push({
      ...deepClone(category),
      id: categoryIdMap.get(category.id),
      entityIds: [entityId]
    });
  }
  for (const technology of sourceTechnologies) {
    result.catalog.technologies.push({
      ...deepClone(technology),
      id: technologyIdMap.get(technology.id),
      entityId,
      categoryId: categoryIdMap.get(technology.categoryId),
      prerequisiteIds: technology.prerequisiteIds.map(id => technologyIdMap.get(id)).filter(Boolean),
      activatedModifierIds: technology.activatedModifierIds.map(id => modifierIdMap.get(id)).filter(Boolean),
      onComplete: {
        activateModifierIds: technology.onComplete.activateModifierIds.map(id => modifierIdMap.get(id)).filter(Boolean),
        deactivateModifierIds: technology.onComplete.deactivateModifierIds.map(id => modifierIdMap.get(id)).filter(Boolean)
      }
    });
  }
  for (const modifier of sourceModifiers) {
    const projectScoped = modifier.scopeType === "project";
    result.catalog.modifiers.push({
      ...deepClone(modifier),
      id: modifierIdMap.get(modifier.id),
      entityId,
      active: projectScoped ? false : modifier.active,
      scopeType: projectScoped ? "all" : modifier.scopeType,
      scopeId: projectScoped ? "" : remapImportedScope(modifier, categoryIdMap, technologyIdMap)
    });
  }

  return {
    envelope: result,
    entityId,
    entityName,
    categoryCount: sourceCategories.length,
    technologyCount: sourceTechnologies.length,
    modifierCount: sourceModifiers.length
  };
}

export function validateRawEnvelope(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(localize("Errors.ImportShape"));
  if (raw.format && raw.format !== MODULE_ID) throw new Error(localize("Errors.ImportFormat"));
  if (!raw.catalog || typeof raw.catalog !== "object" || Array.isArray(raw.catalog)) throw new Error(localize("Errors.ImportCatalog"));
  if (!raw.researchState || typeof raw.researchState !== "object" || Array.isArray(raw.researchState)) throw new Error(localize("Errors.ImportState"));
  if (!raw.moduleConfig || typeof raw.moduleConfig !== "object" || Array.isArray(raw.moduleConfig)) throw new Error(localize("Errors.ImportConfig"));

  const collections = [
    raw.catalog.entities,
    raw.catalog.categories,
    raw.catalog.technologies,
    raw.catalog.modifiers,
    raw.researchState.projects
  ];
  if (collections.some(value => !Array.isArray(value))) throw new Error(localize("Errors.ImportCollections"));
  const ids = [];
  for (const collection of collections) {
    for (const record of collection) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(localize("Errors.ImportRecord"));
      if (typeof record.id !== "string" || !record.id.trim()) throw new Error(localize("Errors.ImportId"));
      ids.push(record.id.trim());
    }
  }
  if (ids.length !== new Set(ids).size) throw new Error(localize("Errors.ImportDuplicateId"));
  rejectNonFiniteNumbers(raw);
  rejectEmbeddedImages(raw.catalog);
  return true;
}

async function confirmTreeImport(envelope) {
  const entity = envelope.catalog.entities[0];
  const counts = {
    name: entity.name,
    categories: entity.categoryIds.length,
    technologies: envelope.catalog.technologies.filter(item => item.entityId === entity.id).length
  };
  const content = `<p>${escapeForDialog(localize("Import.TreeConfirmBody", counts))}</p><p>${escapeForDialog(localize("Import.BackupCreated"))}</p>`;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title: localize("Import.TreeConfirmTitle") },
      content,
      yes: { label: localize("Import.AddTree"), icon: "fa-solid fa-file-circle-plus" },
      no: { label: localize("Common.Cancel") },
      modal: true
    });
  }
  return globalThis.confirm?.(localize("Import.TreeConfirmBody", counts)) ?? false;
}

async function confirmFullRestore(envelope) {
  const counts = {
    entities: envelope.catalog.entities.length,
    technologies: envelope.catalog.technologies.length,
    projects: envelope.researchState.projects.length
  };
  const content = `<p>${escapeForDialog(localize("Import.ConfirmBody", counts))}</p><p>${escapeForDialog(localize("Import.BackupCreated"))}</p>`;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title: localize("Import.ConfirmTitle") },
      content,
      yes: { label: localize("Common.Import"), icon: "fa-solid fa-file-import" },
      no: { label: localize("Common.Cancel") },
      modal: true
    });
  }
  return globalThis.confirm?.(localize("Import.ConfirmBody", counts)) ?? false;
}

function remapImportedScope(modifier, categoryIdMap, technologyIdMap) {
  if (modifier.scopeType === "category") return categoryIdMap.get(modifier.scopeId) ?? "";
  if (modifier.scopeType === "technology") return technologyIdMap.get(modifier.scopeId) ?? "";
  return modifier.scopeId;
}

function uniqueImportedName(existingEntities, requestedName) {
  const base = String(requestedName || localize("Entity.Type.Country")).trim();
  const used = new Set(existingEntities.map(entity => String(entity.name).trim().toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  const suffix = localize("Import.NameSuffix");
  let candidate = `${base} (${suffix})`;
  let index = 2;
  while (used.has(candidate.toLocaleLowerCase())) {
    candidate = `${base} (${suffix} ${index})`;
    index += 1;
  }
  return candidate;
}

function downloadJson(value, filename) {
  const content = JSON.stringify(value, null, 2);
  const saver = globalThis.foundry?.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  if (typeof saver === "function") {
    saver(content, "application/json", filename);
    return;
  }
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rejectNonFiniteNumbers(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) {
    if (typeof child === "number" && !Number.isFinite(child)) throw new Error(localize("Errors.ImportNumber"));
    if (child && typeof child === "object") rejectNonFiniteNumbers(child, seen);
  }
}

function rejectEmbeddedImages(catalog) {
  const paths = [
    ...(catalog.entities ?? []).flatMap(entity => [entity.icon, entity.banner]),
    ...(catalog.categories ?? []).map(category => category.icon),
    ...(catalog.technologies ?? []).map(technology => technology.icon)
  ];
  if (paths.some(path => String(path ?? "").trim().toLowerCase().startsWith("data:"))) {
    throw new Error(localize("Errors.EmbeddedImage"));
  }
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function escapeForDialog(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
