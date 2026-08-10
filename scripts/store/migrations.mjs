import { ROLL_MODES, SCHEMA_VERSION } from "../constants.mjs";
import {
  normalizeCatalog,
  normalizeModuleConfig,
  normalizeResearchState
} from "./schema.mjs";

export function migrateWorldEnvelope(raw = {}) {
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let version = Number.isInteger(Number(raw.schemaVersion)) ? Number(raw.schemaVersion) : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`Schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`);
  }

  let envelope = {
    schemaVersion: version,
    catalog: raw.catalog,
    researchState: raw.researchState,
    moduleConfig: raw.moduleConfig
  };

  if (version < 1) {
    envelope = migrateToVersion1(envelope);
    version = 1;
  }

  if (version < 2) {
    envelope = migrateToVersion2(envelope);
    version = 2;
  }

  if (version < 3) {
    envelope = migrateToVersion3(envelope);
    version = 3;
  }

  if (version < 4) {
    envelope = migrateToVersion4(envelope);
    version = 4;
  }

  if (version < 5) {
    envelope = migrateToVersion5(envelope);
    version = 5;
  }

  const moduleConfig = normalizeModuleConfig(envelope.moduleConfig);
  const researchState = normalizeResearchState(envelope.researchState);
  researchState.history = researchState.history.slice(-moduleConfig.historyLimit);
  return {
    schemaVersion: SCHEMA_VERSION,
    catalog: normalizeCatalog(envelope.catalog),
    researchState,
    moduleConfig
  };
}

function migrateToVersion1(envelope) {
  return {
    ...envelope,
    schemaVersion: 1,
    catalog: envelope.catalog ?? {},
    researchState: envelope.researchState ?? {},
    moduleConfig: envelope.moduleConfig ?? {}
  };
}

function migrateToVersion2(envelope) {
  const moduleConfig = { ...(envelope.moduleConfig ?? {}) };
  const usesUntouchedDefaultFormula = !moduleConfig.rollMode
    || (moduleConfig.rollMode === ROLL_MODES.FORMULA
      && (!moduleConfig.engineeringFormula || moduleConfig.engineeringFormula === "1d20"));
  if (usesUntouchedDefaultFormula) moduleConfig.rollMode = ROLL_MODES.SWADE_SKILL;
  return {
    ...envelope,
    schemaVersion: 2,
    moduleConfig
  };
}

function migrateToVersion3(envelope) {
  return {
    ...envelope,
    schemaVersion: 3
  };
}

function migrateToVersion4(envelope) {
  return {
    ...envelope,
    schemaVersion: 4
  };
}

function migrateToVersion5(envelope) {
  const catalog = envelope.catalog && typeof envelope.catalog === "object" ? envelope.catalog : {};
  const entities = Array.isArray(catalog.entities) ? catalog.entities : [];
  const entityById = new Map(entities.map(entity => [String(entity?.id ?? ""), entity]));
  const technologies = (Array.isArray(catalog.technologies) ? catalog.technologies : []).map(rawTechnology => {
    const technology = rawTechnology && typeof rawTechnology === "object" ? rawTechnology : {};
    if (String(technology.researchSkill ?? "").trim()) return { ...technology };
    const entity = entityById.get(String(technology.entityId ?? ""));
    return {
      ...technology,
      researchSkill: String(entity?.researchSkill ?? "engineering"),
      researchSkillName: String(entity?.researchSkillName ?? "")
    };
  });
  return {
    ...envelope,
    schemaVersion: 5,
    catalog: { ...catalog, technologies }
  };
}
