import {
  MODULE_ID,
  SCHEMA_VERSION,
  SETTINGS,
  localize,
  reportError
} from "../constants.mjs";
import { deepClone } from "../utils/validation.mjs";
import { migrateWorldEnvelope } from "./migrations.mjs";
import {
  defaultCatalog,
  defaultClientState,
  defaultModuleConfig,
  defaultResearchState,
  normalizeClientState
} from "./schema.mjs";
import { repairEnvelopeIntegrity, validateEnvelopeIntegrity } from "./integrity.mjs";

export class ResearchStore {
  #data = null;
  #clientState = defaultClientState();
  #listeners = new Set();
  #queue = Promise.resolve();
  #writing = false;
  #dataRevision = 0;

  registerSettings() {
    this.#registerWorldSetting(SETTINGS.SCHEMA_VERSION, Number, SCHEMA_VERSION);
    this.#registerWorldSetting(SETTINGS.CATALOG, Object, defaultCatalog());
    this.#registerWorldSetting(SETTINGS.RESEARCH_STATE, Object, defaultResearchState());
    this.#registerWorldSetting(SETTINGS.MODULE_CONFIG, Object, defaultModuleConfig());
    this.#registerWorldSetting(SETTINGS.DATA_REVISION, Number, 0);
    game.settings.register(MODULE_ID, SETTINGS.CLIENT_STATE, {
      name: "RTT.Settings.ClientState.Name",
      scope: "client",
      config: false,
      type: Object,
      default: defaultClientState(),
      onChange: value => {
        this.#clientState = normalizeClientState(value);
        this.#emit("clientState");
      }
    });
  }

  #registerWorldSetting(key, type, defaultValue) {
    game.settings.register(MODULE_ID, key, {
      name: `RTT.Settings.${key}.Name`,
      scope: "world",
      config: false,
      type,
      default: defaultValue,
      onChange: value => this.#onWorldSettingChanged(key, value)
    });
  }

  async initialize() {
    const raw = this.#readSettings();
    let migrated;
    let loadSucceeded = true;
    try {
      migrated = repairEnvelopeIntegrity(migrateWorldEnvelope(raw));
      validateEnvelopeIntegrity(migrated);
    } catch (error) {
      loadSucceeded = false;
      reportError("initialize", error);
      migrated = {
        schemaVersion: SCHEMA_VERSION,
        catalog: defaultCatalog(),
        researchState: defaultResearchState(),
        moduleConfig: defaultModuleConfig()
      };
    }
    this.#data = migrated;
    this.#dataRevision = Number(raw.dataRevision) || 0;
    this.#clientState = normalizeClientState(game.settings.get(MODULE_ID, SETTINGS.CLIENT_STATE));

    const needsMigration = Number(raw.schemaVersion) !== SCHEMA_VERSION
      || JSON.stringify(raw.catalog) !== JSON.stringify(migrated.catalog)
      || JSON.stringify(raw.researchState) !== JSON.stringify(migrated.researchState)
      || JSON.stringify(raw.moduleConfig) !== JSON.stringify(migrated.moduleConfig);
    if (loadSucceeded && needsMigration && game.user?.isGM && isResponsibleGM()) {
      await this.replaceAll(migrated, { reason: "migration", silent: true });
    }
    this.#emit("initialize");
    return this.snapshot();
  }

  #readSettings() {
    return {
      schemaVersion: game.settings.get(MODULE_ID, SETTINGS.SCHEMA_VERSION),
      catalog: game.settings.get(MODULE_ID, SETTINGS.CATALOG),
      researchState: game.settings.get(MODULE_ID, SETTINGS.RESEARCH_STATE),
      moduleConfig: game.settings.get(MODULE_ID, SETTINGS.MODULE_CONFIG),
      dataRevision: game.settings.get(MODULE_ID, SETTINGS.DATA_REVISION)
    };
  }

  #onWorldSettingChanged(key, value) {
    if (!this.#data) return;
    if (this.#writing || key !== SETTINGS.DATA_REVISION) return;
    const revision = Number(value) || 0;
    if (revision <= this.#dataRevision) return;
    void this.reload(`revision:${revision}`).catch(error => reportError("remoteReload", error));
  }

  get catalog() {
    return deepClone(this.#requireData().catalog);
  }

  get state() {
    return deepClone(this.#requireData().researchState);
  }

  get config() {
    return deepClone(this.#requireData().moduleConfig);
  }

  get clientState() {
    return deepClone(this.#clientState);
  }

  snapshot() {
    return deepClone(this.#requireData());
  }

  #requireData() {
    if (!this.#data) throw new Error(localize("Errors.StoreNotReady"));
    return this.#data;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(reason) {
    for (const listener of this.#listeners) {
      try {
        listener(reason, this.snapshot());
      } catch (error) {
        reportError("storeListener", error, { notify: false });
      }
    }
    globalThis.Hooks?.callAll?.("researchTechTreeDataChanged", { reason });
  }

  async reload(reason = "socket") {
    const raw = this.#readSettings();
    const migrated = repairEnvelopeIntegrity(migrateWorldEnvelope(raw));
    validateEnvelopeIntegrity(migrated);
    this.#data = migrated;
    this.#dataRevision = Number(raw.dataRevision) || this.#dataRevision;
    this.#emit(reason);
    return this.snapshot();
  }

  async setClientState(patch) {
    const next = normalizeClientState({ ...this.#clientState, ...deepClone(patch) });
    this.#clientState = next;
    await game.settings.set(MODULE_ID, SETTINGS.CLIENT_STATE, next);
    return this.clientState;
  }

  async transaction(reason, mutator, { silent = false } = {}) {
    assertWorldWriteAuthority();
    const job = async () => {
      assertWorldWriteAuthority();
      const before = this.snapshot();
      const working = this.snapshot();
      const result = await mutator(working);
      const normalized = migrateWorldEnvelope(working);
      validateEnvelopeIntegrity(normalized);
      assertWorldWriteAuthority();
      await this.#persist(normalized, before);
      this.#emit(reason);
      return result;
    };
    const pending = this.#queue.catch(() => undefined).then(job);
    this.#queue = pending;
    return pending;
  }

  async replaceAll(envelope, { reason = "replaceAll", silent = false, expectedEnvelope = null } = {}) {
    return this.transaction(reason, working => {
      if (expectedEnvelope && JSON.stringify(working) !== JSON.stringify(expectedEnvelope)) {
        throw new Error(localize("Errors.ImportWorldChanged"));
      }
      const migrated = migrateWorldEnvelope(envelope);
      validateEnvelopeIntegrity(migrated);
      Object.assign(working, migrated);
    }, { silent });
  }

  async #persist(next, rollback) {
    this.#writing = true;
    this.#data = deepClone(next);
    const nextRevision = Math.max(this.#dataRevision, Number(game.settings.get(MODULE_ID, SETTINGS.DATA_REVISION)) || 0) + 1;
    try {
      await game.settings.set(MODULE_ID, SETTINGS.CATALOG, next.catalog);
      assertWorldWriteAuthority();
      await game.settings.set(MODULE_ID, SETTINGS.RESEARCH_STATE, next.researchState);
      assertWorldWriteAuthority();
      await game.settings.set(MODULE_ID, SETTINGS.MODULE_CONFIG, next.moduleConfig);
      assertWorldWriteAuthority();
      await game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, SCHEMA_VERSION);
      assertWorldWriteAuthority();
      await game.settings.set(MODULE_ID, SETTINGS.DATA_REVISION, nextRevision);
      this.#dataRevision = nextRevision;
    } catch (error) {
      this.#data = deepClone(rollback);
      try {
        await game.settings.set(MODULE_ID, SETTINGS.CATALOG, rollback.catalog);
        await game.settings.set(MODULE_ID, SETTINGS.RESEARCH_STATE, rollback.researchState);
        await game.settings.set(MODULE_ID, SETTINGS.MODULE_CONFIG, rollback.moduleConfig);
        await game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, rollback.schemaVersion);
      } catch (rollbackError) {
        reportError("rollback", rollbackError);
      }
      throw error;
    } finally {
      this.#writing = false;
    }
  }

}

export function isResponsibleGM() {
  const activeGM = game.users?.activeGM;
  if (activeGM) return activeGM.id === game.user?.id;
  const activeGMs = [...(game.users ?? [])]
    .filter(user => user.active && user.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return activeGMs[0]?.id === game.user?.id;
}

export function hasResponsibleGM() {
  if (game.users?.activeGM) return true;
  return [...(game.users ?? [])].some(user => user.active && user.isGM);
}

function assertWorldWriteAuthority() {
  if (!game.user?.isGM) throw new Error(localize("Errors.GMOnly"));
  if (!isResponsibleGM()) throw new Error(localize("Errors.ActiveGMOnly"));
}

export const researchStore = new ResearchStore();
