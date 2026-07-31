import {
  LIMITS,
  PROJECT_STATUS,
  RESULT_METHODS,
  ROLL_MODES,
  TECHNOLOGY_VISIBILITY,
  localize,
  reportError
} from "../constants.mjs";
import { escapeHtml } from "../utils/validation.mjs";
import {
  canViewTechnology,
  requireKnownUser,
  validateEngineerRollPermission
} from "./permission-service.mjs";

const systemAdapters = new Map();

export function registerSystemAdapter(id, adapter) {
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId || typeof adapter !== "function") throw new TypeError("A system adapter requires an ID and a function.");
  systemAdapters.set(normalizedId, adapter);
  return () => systemAdapters.delete(normalizedId);
}

export function registeredSystemAdapters() {
  return [...systemAdapters.keys()];
}

export function convertRollTotal(total, config) {
  const numericTotal = Number(total);
  if (!Number.isFinite(numericTotal)) throw new Error(localize("Errors.InvalidRollTotal"));
  if (config.resultMethod !== RESULT_METHODS.RESULT_BANDS) return Math.max(0, Math.floor(numericTotal));
  const band = config.resultBands.find(item => numericTotal >= item.min && numericTotal <= item.max);
  return Math.max(0, Math.trunc(Number(band?.points) || 0));
}

export class RollService {
  constructor(store) {
    this.store = store;
  }

  async rollEngineer({
    projectId,
    engineerSlot,
    actorUuid,
    requesterUserId,
    requestId,
    requestedWeek,
    manualResult,
    automatic = false
  }) {
    const snapshot = this.store.snapshot();
    const { catalog, researchState, moduleConfig } = snapshot;
    const requester = requireKnownUser(requesterUserId);
    const project = researchState.projects.find(item => item.id === projectId);
    if (!project || project.status !== PROJECT_STATUS.ACTIVE || project.paused) {
      throw new Error(localize("Errors.ProjectNotRollable"));
    }
    if (Number(requestedWeek) !== researchState.currentWeek) throw new Error(localize("Errors.WeekChanged"));
    const entity = catalog.entities.find(item => item.id === project.entityId);
    const technology = catalog.technologies.find(item => item.id === project.technologyId);
    if (!entity || !technology) throw new Error(localize("Errors.ProjectReferences"));
    const { actor, slot } = await validateEngineerRollPermission({
      user: requester,
      entity,
      technology,
      researchState,
      project,
      engineerSlot,
      actorUuid
    });
    if (project.weeklyRolls?.[researchState.currentWeek]?.[slot]) throw new Error(localize("Errors.EngineerAlreadyRolled"));
    if (actorAlreadyRolled(researchState.projects, researchState.currentWeek, actor.uuid)) {
      throw new Error(localize("Errors.EngineerAlreadyRolledElsewhere"));
    }
    if (researchState.processedRequestIds.includes(requestId)) throw new Error(localize("Errors.DuplicateRequest"));

    const evaluated = await this.#evaluate({
      actor,
      requester,
      project,
      technology,
      entity,
      config: moduleConfig,
      manualResult,
      automatic
    });
    const points = evaluated.points ?? convertRollTotal(evaluated.total, moduleConfig);
    const record = {
      total: evaluated.total,
      points,
      actorUuid: actor.uuid,
      requestId,
      rolledByUserId: requester.id,
      timestamp: Date.now(),
      formula: evaluated.formula ?? "",
      mode: automatic && moduleConfig.rollMode === ROLL_MODES.MANUAL ? ROLL_MODES.FORMULA : moduleConfig.rollMode
    };

    await this.store.transaction("rollEngineer", envelope => {
      const liveProject = envelope.researchState.projects.find(item => item.id === projectId);
      const liveWeek = envelope.researchState.currentWeek;
      if (!liveProject || liveProject.status !== PROJECT_STATUS.ACTIVE || liveProject.paused) {
        throw new Error(localize("Errors.ProjectNotRollable"));
      }
      if (liveWeek !== researchState.currentWeek) throw new Error(localize("Errors.WeekChanged"));
      const liveEntity = envelope.catalog.entities.find(item => item.id === liveProject.entityId);
      const liveTechnology = envelope.catalog.technologies.find(item => item.id === liveProject.technologyId);
      if (!canViewTechnology(requester, liveEntity, liveTechnology, envelope.researchState)) {
        throw new Error(localize("Errors.TechnologyAccess"));
      }
      const liveAssignment = liveProject.engineers.find(item => item.slot === slot);
      if (liveAssignment?.actorUuid !== actor.uuid) throw new Error(localize("Errors.EngineerAssignmentChanged"));
      if (liveProject.weeklyRolls?.[liveWeek]?.[slot]) throw new Error(localize("Errors.EngineerAlreadyRolled"));
      if (actorAlreadyRolled(envelope.researchState.projects, liveWeek, actor.uuid)) {
        throw new Error(localize("Errors.EngineerAlreadyRolledElsewhere"));
      }
      if (envelope.researchState.processedRequestIds.includes(requestId)) throw new Error(localize("Errors.DuplicateRequest"));
      liveProject.weeklyRolls[liveWeek] ??= {};
      liveProject.weeklyRolls[liveWeek][slot] = record;
      envelope.researchState.processedRequestIds.push(requestId);
      envelope.researchState.processedRequestIds = envelope.researchState.processedRequestIds.slice(-LIMITS.MAX_PROCESSED_REQUEST_IDS);
    });

    try {
      await this.#postRollMessage({ actor, entity, technology, project, week: researchState.currentWeek, record, roll: evaluated.roll });
    } catch (error) {
      reportError("rollChatMessage", error, { notify: false });
      ui.notifications?.warn?.(localize("Warnings.RollSavedChatFailed"));
    }
    return record;
  }

  async #evaluate({ actor, requester, project, technology, entity, config, manualResult, automatic }) {
    if (config.rollMode === ROLL_MODES.MANUAL && !automatic) {
      if (!requester.isGM) throw new Error(localize("Errors.ManualRollGMOnly"));
      const total = Number(manualResult);
      if (!Number.isFinite(total)) throw new Error(localize("Errors.InvalidRollTotal"));
      return { total, formula: localize("Roll.Manual") };
    }

    if (config.rollMode === ROLL_MODES.SYSTEM_ADAPTER) {
      const adapter = systemAdapters.get(config.systemAdapterId);
      if (!adapter) throw new Error(localize("Errors.AdapterMissing", { id: config.systemAdapterId || "—" }));
      const result = await adapter({ actor, requester, project, technology, entity, automatic });
      const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
      if (RollClass && result instanceof RollClass) {
        if (result.total === undefined || result.total === null) await result.evaluate({ allowInteractive: false });
        return { total: Number(result.total), formula: result.formula, roll: result };
      }
      const total = Number(result?.total ?? result);
      if (!Number.isFinite(total)) throw new Error(localize("Errors.AdapterResult"));
      const points = result?.points === undefined ? undefined : Math.max(0, Math.trunc(Number(result.points) || 0));
      return { total, points, formula: String(result?.formula ?? config.systemAdapterId) };
    }

    const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
    if (!RollClass) throw new Error(localize("Errors.RollUnavailable"));
    const formula = config.engineeringFormula || "1d20";
    if (typeof RollClass.validate === "function" && !RollClass.validate(formula)) {
      throw new Error(localize("Errors.InvalidFormula", { formula }));
    }
    const rollData = actor.getRollData?.() ?? {};
    const roll = await new RollClass(formula, rollData).evaluate({ allowInteractive: false });
    const total = Number(roll.total);
    if (!Number.isFinite(total)) throw new Error(localize("Errors.InvalidRollTotal"));
    return { total, formula, roll };
  }

  async #postRollMessage({ actor, entity, technology, project, week, record, roll }) {
    const flavor = `<div class="rtt-chat-roll">
      <strong>${escapeHtml(localize("Roll.Engineering"))}</strong><br>
      ${escapeHtml(localize("Roll.EngineerLine", { engineer: actor.name }))}<br>
      ${escapeHtml(localize("Roll.ProjectLine", {
        project: localize("Roll.ProjectName", { technology: technology.name }),
        technology: technology.name
      }))}<br>
      ${escapeHtml(localize("Roll.WeekLine", { week }))}<br>
      ${escapeHtml(localize("Roll.PointsLine", { points: record.points }))}
    </div>`;
    const messageData = {
      speaker: getSpeaker(actor),
      flavor,
      ...privateMessageData(entity, technology)
    };
    if (roll?.toMessage) {
      await roll.toMessage(messageData);
      return;
    }
    const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
    await ChatMessageClass.create({
      ...messageData,
      content: `${flavor}<p><strong>${escapeHtml(localize("Roll.Total"))}:</strong> ${record.total}</p>`
    });
  }
}

function getSpeaker(actor) {
  const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
  return ChatMessageClass.getSpeaker?.({ actor }) ?? { actor: actor.id, alias: actor.name };
}

export function privateMessageData(entity, technology = null) {
  const gmIds = [...(game.users ?? [])].filter(user => user.isGM).map(user => user.id);
  if (technology?.visibility === TECHNOLOGY_VISIBILITY.HIDDEN) return { whisper: [...new Set(gmIds)] };
  if (entity.public) return {};
  const recipients = [...new Set([...(entity.allowedUserIds ?? []), ...gmIds])];
  return { whisper: recipients };
}

function actorAlreadyRolled(projects, week, actorUuid) {
  return projects.some(project => Object.values(project.weeklyRolls?.[week] ?? {})
    .some(record => record?.actorUuid === actorUuid));
}
