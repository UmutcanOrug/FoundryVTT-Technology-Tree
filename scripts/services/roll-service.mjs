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
import { researchSkillLabel, resolveResearchSkill } from "./swade-skill-service.mjs";

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

export function swadeRaiseCount(total, targetNumber = 4) {
  const numericTotal = Number(total);
  const numericTarget = Number(targetNumber);
  if (!Number.isFinite(numericTotal) || !Number.isFinite(numericTarget)) {
    throw new Error(localize("Errors.InvalidRollTotal"));
  }
  if (numericTotal < numericTarget) return 0;
  return Math.max(0, Math.floor((numericTotal - numericTarget) / 4));
}

export function swadeResearchAward(total, { targetNumber = 4, rpOnSuccess = 1, rpPerRaise = 1 } = {}) {
  const numericTotal = Number(total);
  const numericTarget = Number(targetNumber);
  if (!Number.isFinite(numericTotal) || !Number.isFinite(numericTarget)) {
    throw new Error(localize("Errors.InvalidRollTotal"));
  }
  const success = numericTotal >= numericTarget;
  const raiseCount = swadeRaiseCount(numericTotal, numericTarget);
  const successPoints = Math.max(0, Math.trunc(Number(rpOnSuccess) || 0));
  const raisePoints = Math.max(0, Math.trunc(Number(rpPerRaise) || 0));
  return {
    success,
    raiseCount,
    points: (success ? successPoints : 0) + (raiseCount * raisePoints)
  };
}

export async function ensureRollEvaluated(roll) {
  if (!roll) throw new Error(localize("Errors.RollCancelled"));
  const hasEvaluationState = typeof roll._evaluated === "boolean";
  const hasUsableTotal = roll.total !== undefined
    && roll.total !== null
    && Number.isFinite(Number(roll.total));
  const hasUnevaluatedDice = rollDice(roll).some(die => {
    if (die?._evaluated === false || die?.evaluated === false) return true;
    return Array.isArray(die?.results) && die.results.length === 0;
  });
  if (roll._evaluated === false || hasUnevaluatedDice || (!hasEvaluationState && !hasUsableTotal)) {
    if (typeof roll.evaluate !== "function") throw new Error(localize("Errors.InvalidRollTotal"));
    return await roll.evaluate({ allowInteractive: false }) ?? roll;
  }
  return roll;
}

export function selectBestSwadeResearchResult(previousTotal, rerollTotal, entity = {}) {
  const previous = Number(previousTotal);
  const reroll = Number(rerollTotal);
  if (!Number.isFinite(previous) || !Number.isFinite(reroll)) {
    throw new Error(localize("Errors.InvalidRollTotal"));
  }
  const total = Math.max(previous, reroll);
  return {
    previousTotal: previous,
    rerollTotal: reroll,
    keptReroll: reroll > previous,
    total,
    ...swadeResearchAward(total, entity)
  };
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
      mode: evaluated.mode ?? (automatic && moduleConfig.rollMode === ROLL_MODES.MANUAL ? ROLL_MODES.FORMULA : moduleConfig.rollMode),
      skillName: evaluated.skillName ?? "",
      skillSwid: evaluated.skillSwid ?? "",
      success: evaluated.success ?? false,
      raiseCount: evaluated.raiseCount ?? 0,
      bennyRerolls: 0,
      lastRerollTotal: null,
      lastRequestId: ""
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

  async rerollEngineer({
    projectId,
    engineerSlot,
    actorUuid,
    requesterUserId,
    requestId,
    requestedWeek
  }) {
    const snapshot = this.store.snapshot();
    const { catalog, researchState } = snapshot;
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
    const previousRecord = project.weeklyRolls?.[researchState.currentWeek]?.[slot];
    if (!previousRecord) throw new Error(localize("Errors.RollRequiredBeforeBenny"));
    if (previousRecord.mode !== ROLL_MODES.SWADE_SKILL) throw new Error(localize("Errors.BennySwadeOnly"));
    if (researchState.processedRequestIds.includes(requestId)) throw new Error(localize("Errors.DuplicateRequest"));

    const spender = bennySpender(actor, requester);
    if (!spender) throw new Error(localize("Errors.NoBennies"));
    const evaluated = await this.#evaluateSwadeSkill({ actor, project, technology, entity, bennyReroll: true });
    if (await spender.spendBenny() === false) throw new Error(localize("Errors.NoBennies"));

    let record;
    let rerollInfo;
    try {
      await this.store.transaction("rerollEngineer", envelope => {
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
        const liveRecord = liveProject.weeklyRolls?.[liveWeek]?.[slot];
        if (!liveRecord) throw new Error(localize("Errors.RollRequiredBeforeBenny"));
        if (liveRecord.mode !== ROLL_MODES.SWADE_SKILL) throw new Error(localize("Errors.BennySwadeOnly"));
        if (envelope.researchState.processedRequestIds.includes(requestId)) throw new Error(localize("Errors.DuplicateRequest"));

        const best = selectBestSwadeResearchResult(liveRecord.total, evaluated.total, liveEntity);
        rerollInfo = best;
        record = {
          ...liveRecord,
          total: best.total,
          points: best.points,
          success: best.success,
          raiseCount: best.raiseCount,
          formula: best.keptReroll ? evaluated.formula : liveRecord.formula,
          timestamp: Date.now(),
          bennyRerolls: Math.max(0, Math.trunc(Number(liveRecord.bennyRerolls) || 0)) + 1,
          lastRerollTotal: best.rerollTotal,
          lastRequestId: requestId
        };
        liveProject.weeklyRolls[liveWeek][slot] = record;
        envelope.researchState.processedRequestIds.push(requestId);
        envelope.researchState.processedRequestIds = envelope.researchState.processedRequestIds.slice(-LIMITS.MAX_PROCESSED_REQUEST_IDS);
      });
    } catch (error) {
      try {
        await spender.getBenny?.();
      } catch (refundError) {
        reportError("bennyRefund", refundError, { notify: false });
      }
      throw error;
    }

    try {
      await this.#postRollMessage({
        actor,
        entity,
        technology,
        project,
        week: researchState.currentWeek,
        record,
        roll: evaluated.roll,
        rerollInfo
      });
    } catch (error) {
      reportError("bennyRerollChatMessage", error, { notify: false });
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

    if (config.rollMode === ROLL_MODES.SWADE_SKILL) {
      return this.#evaluateSwadeSkill({ actor, project, technology, entity });
    }

    if (config.rollMode === ROLL_MODES.SYSTEM_ADAPTER) {
      const adapter = systemAdapters.get(config.systemAdapterId);
      if (!adapter) throw new Error(localize("Errors.AdapterMissing", { id: config.systemAdapterId || "—" }));
      const result = await adapter({ actor, requester, project, technology, entity, automatic });
      const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
      if (RollClass && result instanceof RollClass) {
        const roll = await ensureRollEvaluated(result);
        return { total: Number(roll.total), formula: roll.formula, roll };
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

  async #evaluateSwadeSkill({ actor, project, technology, entity, bennyReroll = false }) {
    if (globalThis.game?.system?.id !== "swade" || typeof actor?.rollSkill !== "function") {
      throw new Error(localize("Errors.SwadeRequired"));
    }
    const skill = resolveResearchSkill(actor, entity.researchSkill, entity.researchSkillName);
    const skillLabel = researchSkillLabel(entity.researchSkill, entity.researchSkillName);
    if (!skill) throw new Error(localize("Errors.SkillMissing", { actor: actor.name, skill: skillLabel }));

    const pendingRoll = await actor.rollSkill(skill.id, {
      suppressChat: true,
      isRerollable: false,
      title: localize("Roll.SkillTitle", { skill: skill.name }),
      flavour: localize("Roll.ProjectLine", {
        project: localize("Roll.ProjectName", { technology: technology.name }),
        technology: technology.name
      })
    });
    if (!pendingRoll) throw new Error(localize("Errors.RollCancelled"));
    if (bennyReroll) {
      if ("rerollMode" in pendingRoll) pendingRoll.rerollMode = "benny";
      pendingRoll.applyReroll?.(actor);
    }
    pendingRoll.setRerollable?.(false);
    const roll = await ensureRollEvaluated(pendingRoll);
    const total = Number(roll.total);
    if (!Number.isFinite(total)) throw new Error(localize("Errors.InvalidRollTotal"));
    const { success, raiseCount, points } = swadeResearchAward(total, entity);
    return {
      total,
      points,
      success,
      raiseCount,
      formula: roll.formula,
      roll,
      mode: ROLL_MODES.SWADE_SKILL,
      skillName: skill.name,
      skillSwid: skill.system?.swid ?? entity.researchSkill
    };
  }

  async #postRollMessage({ actor, entity, technology, project, week, record, roll, rerollInfo = null }) {
    const rollTitle = record.skillName
      ? localize("Roll.SkillTitle", { skill: record.skillName })
      : localize("Roll.Engineering");
    const outcomeLine = record.mode === ROLL_MODES.SWADE_SKILL
      ? `${escapeHtml(localize("Roll.OutcomeLine", {
        outcome: localize(record.success ? "Roll.Success" : "Roll.Failure")
      }))}<br>`
      : "";
    const rerollLine = rerollInfo
      ? `${escapeHtml(localize("Roll.BennyResultLine", {
        reroll: rerollInfo.rerollTotal,
        previous: rerollInfo.previousTotal,
        best: rerollInfo.total
      }))}<br>`
      : "";
    const flavor = `<div class="rtt-chat-roll">
      <strong>${escapeHtml(rollTitle)}</strong><br>
      ${escapeHtml(localize("Roll.EngineerLine", { engineer: actor.name }))}<br>
      ${escapeHtml(localize("Roll.ProjectLine", {
        project: localize("Roll.ProjectName", { technology: technology.name }),
        technology: technology.name
      }))}<br>
      ${escapeHtml(localize("Roll.WeekLine", { week }))}<br>
      ${outcomeLine}
      ${rerollLine}
      ${escapeHtml(localize("Roll.RaisesLine", { raises: record.raiseCount }))}<br>
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

function rollDice(roll) {
  try {
    const dice = roll?.dice;
    if (Array.isArray(dice)) return dice;
    if (dice && typeof dice[Symbol.iterator] === "function") return [...dice];
  } catch (_error) {
    // Some system Roll implementations do not expose dice until after evaluation.
  }
  return [];
}

function bennySpender(actor, requester) {
  if (Number(actor?.bennies) > 0 && typeof actor?.spendBenny === "function") return actor;
  if (requester?.isGM && Number(requester?.bennies) > 0 && typeof requester?.spendBenny === "function") return requester;
  return null;
}
