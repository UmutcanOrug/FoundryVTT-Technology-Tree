import { PROJECT_STATUS, TECHNOLOGY_VISIBILITY, localize, reportError } from "../constants.mjs";
import { createStableId, escapeHtml } from "../utils/validation.mjs";
import { activeModifiersFor, calculateWeeklyResearch, effectiveResearchCost } from "./modifier-service.mjs";
import { completeProjectInEnvelope } from "./project-service.mjs";
import { privateMessageData } from "./roll-service.mjs";

export class WeekService {
  constructor(store, rollService) {
    this.store = store;
    this.rollService = rollService;
  }

  getMissingRolls(snapshot = this.store.snapshot()) {
    const week = snapshot.researchState.currentWeek;
    const missing = [];
    for (const project of snapshot.researchState.projects) {
      if (project.status !== PROJECT_STATUS.ACTIVE || project.paused) continue;
      for (const engineer of project.engineers) {
        if (!engineer.actorUuid || project.weeklyRolls?.[week]?.[engineer.slot]) continue;
        missing.push({
          projectId: project.id,
          engineerSlot: engineer.slot,
          actorUuid: engineer.actorUuid,
          currentWeek: week
        });
      }
    }
    return missing;
  }

  async advance({ missingRollPolicy = "", requesterUserId }) {
    let snapshot = this.store.snapshot();
    const missing = this.getMissingRolls(snapshot);
    if (missing.length && !["zero", "auto"].includes(missingRollPolicy)) {
      throw new Error(localize("Errors.MissingRollPolicy"));
    }

    if (missingRollPolicy === "auto") {
      for (const item of missing) {
        await this.rollService.rollEngineer({
          ...item,
          requesterUserId,
          requestId: createStableId("auto-roll"),
          requestedWeek: item.currentWeek,
          automatic: true
        });
      }
      snapshot = this.store.snapshot();
    }

    const week = snapshot.researchState.currentWeek;
    let historyEntry;
    const completions = [];
    await this.store.transaction("advanceWeek", envelope => {
      if (envelope.researchState.currentWeek !== week) throw new Error(localize("Errors.WeekChanged"));
      const entitySummaries = new Map();
      const pendingCompletions = [];

      for (const project of envelope.researchState.projects) {
        if (project.status !== PROJECT_STATUS.ACTIVE || project.paused) continue;
        const entity = envelope.catalog.entities.find(item => item.id === project.entityId);
        const technology = envelope.catalog.technologies.find(item => item.id === project.technologyId);
        if (!entity || !technology) continue;
        const modifiers = activeModifiersFor(envelope.catalog, {
          week,
          entityId: entity.id,
          technology,
          project
        });
        const rollMap = project.weeklyRolls?.[week] ?? {};
        const engineerRolls = [1, 2].map(slot => rollMap[slot]).filter(Boolean);
        const breakdown = calculateWeeklyResearch({
          workers: project.assignedWorkers,
          basePointsPerWorker: entity.basePointsPerWorker,
          engineerPoints: engineerRolls.map(roll => roll.points),
          modifiers
        });
        const effectiveCost = effectiveResearchCost(technology.researchPointCost, modifiers);
        const progressBefore = project.progress;
        project.progress = Math.min(effectiveCost, Math.max(0, project.progress + breakdown.weeklyTotal));
        const completed = project.progress >= effectiveCost;
        if (completed) pendingCompletions.push({ project, technology });

        const summary = entitySummaries.get(entity.id) ?? {
          entityId: entity.id,
          entityName: entity.name,
          projectResults: [],
          completedTechnologyIds: []
        };
        summary.projectResults.push({
          projectId: project.id,
          technologyId: technology.id,
          technologyName: technology.name,
          progressBefore,
          progressAfter: project.progress,
          effectiveCost,
          assignedWorkers: project.assignedWorkers,
          engineerRolls,
          appliedModifierIds: modifiers.map(modifier => modifier.id),
          completed,
          ...breakdown
        });
        if (completed) summary.completedTechnologyIds.push(technology.id);
        entitySummaries.set(entity.id, summary);
      }

      for (const { project, technology } of pendingCompletions) {
        completions.push(completeProjectInEnvelope(envelope, project, technology, week));
      }

      historyEntry = {
        id: createStableId("history"),
        week,
        processedAt: new Date().toISOString(),
        entities: [...entitySummaries.values()]
      };
      envelope.researchState.history.push(historyEntry);
      envelope.researchState.history = envelope.researchState.history.slice(-envelope.moduleConfig.historyLimit);
      envelope.researchState.currentWeek = week + 1;
    });

    try {
      await this.#postWeeklyMessages(historyEntry, snapshot.catalog);
      await this.#postCompletionMessages(completions, snapshot.catalog);
    } catch (error) {
      reportError("weekChatMessage", error, { notify: false });
      ui.notifications?.warn?.(localize("Warnings.WeekSavedChatFailed"));
    }
    for (const completion of completions) {
      const technology = snapshot.catalog.technologies.find(item => item.id === completion.technologyId);
      ui.notifications?.info?.(localize("Notifications.TechnologyCompleted", { name: technology?.name ?? completion.technologyId }));
    }
    return historyEntry;
  }

  async announceCompletions(completions, catalog = this.store.catalog) {
    const list = (Array.isArray(completions) ? completions : [completions]).filter(Boolean);
    if (!list.length) return;
    try {
      await this.#postCompletionMessages(list, catalog);
    } catch (error) {
      reportError("completionChatMessage", error, { notify: false });
      ui.notifications?.warn?.(localize("Warnings.WeekSavedChatFailed"));
    }
    for (const completion of list) {
      const technology = catalog.technologies.find(item => item.id === completion.technologyId);
      ui.notifications?.info?.(localize("Notifications.TechnologyCompleted", { name: technology?.name ?? completion.technologyId }));
    }
  }

  async #postWeeklyMessages(history, catalog) {
    const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
    if (!history.entities.length) {
      await ChatMessageClass.create({ content: `<div class="rtt-chat-summary"><h3>${escapeHtml(localize("Summary.Week", { week: history.week }))}</h3><p>${escapeHtml(localize("Summary.NoResearch"))}</p></div>` });
      return;
    }
    for (const summary of history.entities) {
      const entity = catalog.entities.find(item => item.id === summary.entityId);
      if (!entity) continue;
      const visibleResults = [];
      const hiddenResults = [];
      for (const result of summary.projectResults) {
        const technology = catalog.technologies.find(item => item.id === result.technologyId);
        (technology?.visibility === TECHNOLOGY_VISIBILITY.HIDDEN ? hiddenResults : visibleResults).push(result);
      }
      for (const [results, privacyTechnology] of [
        [visibleResults, null],
        [hiddenResults, { visibility: TECHNOLOGY_VISIBILITY.HIDDEN }]
      ]) {
        if (!results.length) continue;
        const rows = results.map(result => weeklyResultHtml(result)).join("");
        await ChatMessageClass.create({
          content: `<div class="rtt-chat-summary"><h3>${escapeHtml(localize("Summary.Week", { week: history.week }))}</h3><h4>${escapeHtml(entity.name)}</h4>${rows}</div>`,
          ...privateMessageData(entity, privacyTechnology)
        });
      }
    }
  }

  async #postCompletionMessages(completions, catalog) {
    const ChatMessageClass = globalThis.foundry?.documents?.ChatMessage ?? globalThis.ChatMessage;
    for (const completion of completions) {
      const entity = catalog.entities.find(item => item.id === completion.entityId);
      const technology = catalog.technologies.find(item => item.id === completion.technologyId);
      if (!entity || !technology) continue;
      await ChatMessageClass.create({
        content: `<div class="rtt-chat-completion"><i class="fa-solid fa-flask-vial"></i> ${escapeHtml(localize("Notifications.TechnologyCompleted", { name: technology.name }))}</div>`,
        ...privateMessageData(entity, technology)
      });
    }
  }
}

function weeklyResultHtml(result) {
  return `<section>
    <h4>${escapeHtml(result.technologyName)}</h4>
    <div>${escapeHtml(localize("Summary.Workers", { points: result.passiveAdjusted }))}</div>
    <div>${escapeHtml(localize("Summary.Engineers", { points: result.engineerAdjusted }))}</div>
    <div>${escapeHtml(localize("Summary.Modifiers", { points: result.modifierDelta }))}</div>
    <div><strong>${escapeHtml(localize("Summary.WeeklyTotal", { points: result.weeklyTotal }))}</strong></div>
    <div>${escapeHtml(localize("Summary.Progress", { progress: result.progressAfter, cost: result.effectiveCost }))}</div>
    ${result.completed ? `<div class="rtt-chat-completed">${escapeHtml(localize("Summary.Completed"))}</div>` : ""}
  </section>`;
}
