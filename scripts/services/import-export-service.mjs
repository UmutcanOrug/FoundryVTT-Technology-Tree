import {
  LIMITS,
  MODULE_ID,
  MODULE_VERSION,
  SCHEMA_VERSION,
  localize
} from "../constants.mjs";
import { validateEnvelopeIntegrity } from "../store/integrity.mjs";
import { migrateWorldEnvelope } from "../store/migrations.mjs";
import { deepClone, parseJson, slugForFilename } from "../utils/validation.mjs";
import { validateModuleConfig } from "./config-validation.mjs";
import { isResponsibleGM } from "../store/research-store.mjs";

export class ImportExportService {
  constructor(store) {
    this.store = store;
  }

  createExportEnvelope(snapshot = this.store.snapshot()) {
    return {
      format: MODULE_ID,
      schemaVersion: SCHEMA_VERSION,
      moduleVersion: game.modules?.get?.(MODULE_ID)?.version ?? MODULE_VERSION,
      exportedAt: new Date().toISOString(),
      catalog: deepClone(snapshot.catalog),
      researchState: deepClone(snapshot.researchState),
      moduleConfig: deepClone(snapshot.moduleConfig)
    };
  }

  exportAll({ backup = false, snapshot = null } = {}) {
    if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
    const stamp = timestampForFilename();
    const filename = `${slugForFilename(MODULE_ID)}-${backup ? "backup" : "export"}-${stamp}.json`;
    downloadJson(this.createExportEnvelope(snapshot ?? this.store.snapshot()), filename);
    return filename;
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

  async importText(text, { confirm = true } = {}) {
    if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
    if (!isResponsibleGM()) throw new Error(localize("Errors.ActiveGMOnly"));
    const migrated = this.validateImportText(text);
    const before = this.store.snapshot();
    this.exportAll({ backup: true, snapshot: before });
    if (confirm && !(await confirmImport(migrated))) return false;
    await this.store.replaceAll(migrated, { reason: "import", expectedEnvelope: before });
    ui.notifications?.info?.(localize("Notifications.ImportComplete"));
    return true;
  }
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

async function confirmImport(envelope) {
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
