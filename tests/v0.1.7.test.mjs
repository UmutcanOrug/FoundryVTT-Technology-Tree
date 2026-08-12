import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ACTIONS, ActionService } from "../scripts/services/action-service.mjs";
import {
  ensureRollEvaluated,
  RollService,
  selectBestSwadeResearchResult,
  swadeRaiseCount,
  swadeResearchAward
} from "../scripts/services/roll-service.mjs";
import {
  resolveResearchSkill,
  worldResearchSkillChoices
} from "../scripts/services/swade-skill-service.mjs";
import {
  buildTreeExportEnvelope,
  ImportExportService,
  mergeTreeIntoEnvelope
} from "../scripts/services/import-export-service.mjs";
import { validateEnvelopeIntegrity } from "../scripts/store/integrity.mjs";
import { migrateWorldEnvelope } from "../scripts/store/migrations.mjs";
import { ProjectService } from "../scripts/services/project-service.mjs";
import { modifierIsCurrentlyActive } from "../scripts/services/modifier-service.mjs";
import { buildResearchContext } from "../scripts/app/context.mjs";

function userCollection(...users) {
  return {
    get: id => users.find(user => user.id === id),
    [Symbol.iterator]: function* iterator() { yield* users; }
  };
}

function setGame({ actors = [], users = [], systemId = "swade" } = {}) {
  globalThis.game = {
    actors,
    users: userCollection(...users),
    system: { id: systemId },
    i18n: {
      lang: "en",
      localize: key => key,
      format: (key, data) => `${key} ${JSON.stringify(data)}`
    }
  };
}

test("SWADE raises use TN 4 and one raise per additional four points", () => {
  assert.deepEqual(
    [3, 4, 7, 8, 11, 12, 15, 16].map(total => swadeRaiseCount(total)),
    [0, 0, 0, 1, 1, 2, 2, 3]
  );
});

test("SWADE success and raise awards are calculated separately", () => {
  assert.deepEqual(swadeResearchAward(3, { rpOnSuccess: 2, rpPerRaise: 3 }), {
    success: false, raiseCount: 0, points: 0
  });
  assert.deepEqual(swadeResearchAward(7, { rpOnSuccess: 2, rpPerRaise: 3 }), {
    success: true, raiseCount: 0, points: 2
  });
  assert.deepEqual(swadeResearchAward(12, { rpOnSuccess: 2, rpPerRaise: 3 }), {
    success: true, raiseCount: 2, points: 8
  });
});

test("unevaluated SWADE rolls with numeric skill modifiers are evaluated exactly once", async () => {
  let evaluationCount = 0;
  const roll = {
    _evaluated: false,
    total: 0,
    formula: "1d6x + 1",
    async evaluate(options) {
      evaluationCount += 1;
      assert.equal(options.allowInteractive, false);
      this._evaluated = true;
      this.total = 7;
      return this;
    }
  };

  const evaluated = await ensureRollEvaluated(roll);
  assert.equal(evaluated.total, 7);
  assert.equal(evaluationCount, 1);
  await ensureRollEvaluated(evaluated);
  assert.equal(evaluationCount, 1);
});

test("SWADE rolls with hidden evaluation state and an empty dice pool are evaluated", async () => {
  let evaluationCount = 0;
  const die = { results: [] };
  const roll = {
    total: 0,
    formula: "{1d8x,1d6x}kh + 1",
    dice: [die],
    async evaluate(options) {
      evaluationCount += 1;
      assert.equal(options.allowInteractive, false);
      die.results.push({ result: 7, active: true });
      this.total = 8;
      return this;
    }
  };

  assert.equal((await ensureRollEvaluated(roll)).total, 8);
  assert.equal(evaluationCount, 1);
  await ensureRollEvaluated(roll);
  assert.equal(evaluationCount, 1);
});

test("Benny rerolls keep the higher SWADE research result", () => {
  assert.deepEqual(selectBestSwadeResearchResult(8, 3, { rpOnSuccess: 2, rpPerRaise: 3 }), {
    previousTotal: 8,
    rerollTotal: 3,
    keptReroll: false,
    total: 8,
    success: true,
    raiseCount: 1,
    points: 5
  });
  assert.equal(selectBestSwadeResearchResult(8, 12, { rpOnSuccess: 2, rpPerRaise: 3 }).total, 12);
});

test("custom skills with duplicate SWIDs resolve by their exact embedded name", () => {
  const actor = {
    items: [
      { id: "wrong", type: "skill", name: "Generic Science", system: { swid: "science" } },
      { id: "right", type: "skill", name: "Nanobilim (Özel)", system: { swid: "science" } }
    ]
  };
  assert.equal(resolveResearchSkill(actor, "science", "Nanobilim (Özel)")?.id, "right");

  setGame({ actors: [{ items: actor.items }] });
  const choices = worldResearchSkillChoices("science", "Nanobilim (Özel)");
  assert.equal(choices.filter(choice => choice.selected).length, 1);
  assert.equal(choices.find(choice => choice.selected)?.skillName, "Nanobilim (Özel)");
});

test("SWADE rolls persist success, raises, and per-organization RP", async () => {
  const gm = { id: "gm", isGM: true };
  const skill = { id: "nano", type: "skill", name: "Nanobilim (Özel)", system: { swid: "science" } };
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Ada",
    documentName: "Actor",
    items: [
      { id: "other", type: "skill", name: "Generic Science", system: { swid: "science" } },
      skill
    ],
    async rollSkill(skillId, options) {
      assert.equal(skillId, "nano");
      assert.equal(options.suppressChat, true);
      return {
        _evaluated: false,
        total: 0,
        formula: "1d10x + 1",
        async evaluate(evaluateOptions) {
          assert.equal(evaluateOptions.allowInteractive, false);
          this._evaluated = true;
          this.total = 12;
          return this;
        },
        async toMessage() {}
      };
    }
  };
  setGame({ actors: [actor], users: [gm] });
  globalThis.foundry = {
    utils: { fromUuid: async uuid => uuid === actor.uuid ? actor : null },
    documents: { ChatMessage: { getSpeaker: () => ({ actor: actor.id, alias: actor.name }) } }
  };
  globalThis.ui = { notifications: { warn() {} } };

  const envelope = {
    catalog: {
      entities: [{
        id: "entity-1", public: true, allowedUserIds: [], researchSkill: "engineering",
        researchSkillName: "Engineering", rpOnSuccess: 2, rpPerRaise: 3
      }],
      technologies: [{
        id: "tech-1", visibility: "public", name: "Nano Tech",
        researchSkill: "science", researchSkillName: "Nanobilim (Özel)"
      }]
    },
    researchState: {
      currentWeek: 1,
      processedRequestIds: [],
      projects: [{
        id: "project-1", entityId: "entity-1", technologyId: "tech-1", status: "active",
        paused: false, engineers: [{ slot: 1, actorUuid: actor.uuid }, { slot: 2, actorUuid: null }],
        weeklyRolls: {}
      }]
    },
    moduleConfig: { rollMode: "swadeSkill", resultMethod: "directTotal", resultBands: [] }
  };
  const store = {
    snapshot: () => structuredClone(envelope),
    transaction: async (_reason, mutator) => mutator(envelope)
  };
  const record = await new RollService(store).rollEngineer({
    projectId: "project-1",
    engineerSlot: 1,
    actorUuid: actor.uuid,
    requesterUserId: gm.id,
    requestId: "request-1",
    requestedWeek: 1
  });

  assert.equal(record.raiseCount, 2);
  assert.equal(record.success, true);
  assert.equal(record.total, 12);
  assert.equal(record.points, 8);
  assert.equal(envelope.researchState.projects[0].weeklyRolls[1][1].points, 8);
});

test("Benny rerolls spend Bennies and persist only the best result", async () => {
  const gm = { id: "gm", isGM: true, bennies: 0 };
  const skill = { id: "science", type: "skill", name: "Science", system: { swid: "science" } };
  const rerollTotals = [3, 12];
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Ada",
    documentName: "Actor",
    items: [skill],
    bennies: 2,
    async spendBenny() {
      if (this.bennies < 1) return false;
      this.bennies -= 1;
      return true;
    },
    async rollSkill(skillId, options) {
      assert.equal(skillId, skill.id);
      assert.equal(options.suppressChat, true);
      assert.equal(options.isRerollable, false);
      const total = rerollTotals.shift();
      return {
        _evaluated: false,
        formula: "{1d8x,1d6x}kh + 1",
        rerollMode: "",
        applyReroll(appliedActor) { assert.equal(appliedActor, actor); },
        setRerollable(value) { assert.equal(value, false); },
        async evaluate() {
          this._evaluated = true;
          this.total = total;
          return this;
        },
        async toMessage() {}
      };
    }
  };
  setGame({ actors: [actor], users: [gm] });
  globalThis.foundry = {
    utils: { fromUuid: async uuid => uuid === actor.uuid ? actor : null },
    documents: { ChatMessage: { getSpeaker: () => ({ actor: actor.id, alias: actor.name }) } }
  };
  globalThis.ui = { notifications: { warn() {} } };

  const envelope = {
    catalog: {
      entities: [{
        id: "entity-1", public: true, allowedUserIds: [], researchSkill: "science",
        researchSkillName: "Science", rpOnSuccess: 2, rpPerRaise: 3
      }],
      technologies: [{ id: "tech-1", entityId: "entity-1", visibility: "public", name: "Nano Tech" }]
    },
    researchState: {
      currentWeek: 1,
      processedRequestIds: [],
      projects: [{
        id: "project-1", entityId: "entity-1", technologyId: "tech-1", status: "active",
        paused: false, engineers: [{ slot: 1, actorUuid: actor.uuid }, { slot: 2, actorUuid: null }],
        weeklyRolls: { 1: { 1: {
          total: 8, points: 5, actorUuid: actor.uuid, mode: "swadeSkill", skillName: "Science",
          success: true, raiseCount: 1, bennyRerolls: 0, formula: "old"
        } } }
      }]
    },
    moduleConfig: { rollMode: "swadeSkill", resultMethod: "directTotal", resultBands: [] }
  };
  const store = {
    snapshot: () => structuredClone(envelope),
    transaction: async (_reason, mutator) => mutator(envelope)
  };
  const service = new RollService(store);
  const baseRequest = {
    projectId: "project-1",
    engineerSlot: 1,
    actorUuid: actor.uuid,
    requesterUserId: gm.id,
    requestedWeek: 1
  };

  const lower = await service.rerollEngineer({ ...baseRequest, requestId: "benny-1" });
  assert.equal(lower.total, 8);
  assert.equal(lower.lastRerollTotal, 3);
  assert.equal(lower.bennyRerolls, 1);
  assert.equal(actor.bennies, 1);

  const higher = await service.rerollEngineer({ ...baseRequest, requestId: "benny-2" });
  assert.equal(higher.total, 12);
  assert.equal(higher.points, 8);
  assert.equal(higher.raiseCount, 2);
  assert.equal(higher.lastRerollTotal, 12);
  assert.equal(higher.bennyRerolls, 2);
  assert.equal(actor.bennies, 0);
});

test("week reset preserves progress and clears only active-cycle roll data", async () => {
  const gm = { id: "gm", isGM: true };
  setGame({ users: [gm] });
  const envelope = {
    researchState: {
      currentWeek: 9,
      history: [{ week: 8 }],
      processedRequestIds: ["request-1"],
      projects: [
        { id: "active", status: "active", progress: 17, startedWeek: 4, weeklyRolls: { 8: { 1: { points: 3 } } } },
        { id: "complete", status: "completed", progress: 30, startedWeek: 2, weeklyRolls: { 3: { 1: { points: 4 } } } }
      ]
    }
  };
  const store = { transaction: async (_reason, mutator) => mutator(envelope) };
  const service = new ActionService({ store, projectService: {}, rollService: {}, weekService: {} });
  await service.handle(ACTIONS.RESET_WEEK, {}, gm.id);

  assert.equal(envelope.researchState.currentWeek, 1);
  assert.deepEqual(envelope.researchState.history, []);
  assert.deepEqual(envelope.researchState.processedRequestIds, []);
  assert.equal(envelope.researchState.projects[0].progress, 17);
  assert.equal(envelope.researchState.projects[0].startedWeek, 1);
  assert.deepEqual(envelope.researchState.projects[0].weeklyRolls, {});
  assert.equal(envelope.researchState.projects[1].progress, 30);
  assert.ok(envelope.researchState.projects[1].weeklyRolls[3]);
});

test("schema v2 data migrates to v5 and freezes the entity skill onto legacy technologies", () => {
  const migrated = migrateWorldEnvelope({
    schemaVersion: 2,
    catalog: {
      entities: [{ id: "entity-1", name: "Legacy", researchSkill: "science", researchSkillName: "Science" }],
      technologies: [{ id: "tech-1", entityId: "entity-1", name: "Legacy Tech" }]
    },
    researchState: {},
    moduleConfig: {}
  });
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.catalog.entities[0].rpOnSuccess, 1);
  assert.equal(migrated.catalog.entities[0].rpPerRaise, 1);
  assert.equal(migrated.catalog.technologies[0].researchSkill, "science");
  assert.equal(migrated.catalog.technologies[0].researchSkillName, "Science");
});

test("new technologies inherit the entity skill as their editable default", async () => {
  const gm = { id: "gm", isGM: true };
  setGame({ users: [gm] });
  const envelope = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{
        id: "entity-1", name: "Institute", categoryIds: ["category-1"],
        researchSkill: "occult", researchSkillName: "Forbidden Lore"
      }],
      categories: [{ id: "category-1", name: "Mysteries", entityIds: ["entity-1"] }]
    },
    researchState: {},
    moduleConfig: {}
  });
  const store = { transaction: async (_reason, mutator) => mutator(envelope) };
  const service = new ActionService({ store, projectService: {}, rollService: {}, weekService: {} });
  await service.handle(ACTIONS.CREATE_TECHNOLOGY, {
    entityId: "entity-1", categoryId: "category-1", name: "Sealed Archive", researchPointCost: 8
  }, gm.id);
  const technology = envelope.catalog.technologies[0];
  assert.equal(technology.researchSkill, "occult");
  assert.equal(technology.researchSkillName, "Forbidden Lore");
});

test("GM-set progress creates a project and completes it at the effective RP cost", async () => {
  const envelope = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{ id: "entity-1", name: "Institute", categoryIds: ["category-1"], maxConcurrentProjects: 1 }],
      categories: [{ id: "category-1", name: "Industry", entityIds: ["entity-1"] }],
      technologies: [{
        id: "tech-1", entityId: "entity-1", categoryId: "category-1", name: "Precision", researchPointCost: 10
      }]
    },
    researchState: {},
    moduleConfig: {}
  });
  const store = { transaction: async (_reason, mutator) => mutator(envelope) };
  const service = new ProjectService(store);

  const partial = await service.setTechnologyProgress("entity-1", "tech-1", 6);
  assert.equal(partial.progress, 6);
  assert.equal(envelope.researchState.projects[0].status, "active");

  const finished = await service.setTechnologyProgress("entity-1", "tech-1", 10);
  assert.equal(finished.completion.technologyId, "tech-1");
  assert.equal(envelope.researchState.projects[0].status, "completed");
  assert.deepEqual(envelope.researchState.completedTechnologyIdsByEntity["entity-1"], ["tech-1"]);
  validateEnvelopeIntegrity(envelope);
});

test("modifier activity includes manual, scheduled, and project-scoped passive states", () => {
  assert.equal(modifierIsCurrentlyActive({ active: false, startWeek: null, endWeek: null, scopeType: "all" }, { week: 3 }), false);
  assert.equal(modifierIsCurrentlyActive({ active: true, startWeek: 4, endWeek: null, scopeType: "all" }, { week: 3 }), false);
  assert.equal(modifierIsCurrentlyActive({ active: true, startWeek: 2, endWeek: 4, scopeType: "all" }, { week: 3 }), true);
  assert.equal(modifierIsCurrentlyActive({ active: true, startWeek: null, endWeek: null, scopeType: "project", scopeId: "project-1" }, {
    week: 3,
    projects: [{ id: "project-1", status: "cancelled" }]
  }), false);
});

test("a modifier can remain passive until its selected unlock technology completes", async () => {
  const gm = { id: "gm", isGM: true };
  setGame({ users: [gm] });
  const envelope = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{ id: "entity-1", name: "Institute", categoryIds: ["category-1"], maxConcurrentProjects: 1 }],
      categories: [{ id: "category-1", name: "Industry", entityIds: ["entity-1"] }],
      technologies: [{
        id: "tech-1", entityId: "entity-1", categoryId: "category-1", name: "Applied Methods", researchPointCost: 5
      }]
    },
    researchState: {},
    moduleConfig: {}
  });
  const store = { transaction: async (_reason, mutator) => mutator(envelope) };
  const projectService = new ProjectService(store);
  const actionService = new ActionService({ store, projectService, rollService: {}, weekService: { announceCompletions: async () => {} } });

  const created = await actionService.handle(ACTIONS.CREATE_MODIFIER, {
    entityId: "entity-1",
    name: "Applied Research Bonus",
    active: true,
    operation: "add",
    target: "weeklyTotal",
    scopeType: "all",
    value: 2,
    unlockTechnologyId: "tech-1"
  }, gm.id);
  const modifier = envelope.catalog.modifiers.find(item => item.id === created.modifierId);
  assert.equal(modifier.active, false);
  assert.deepEqual(envelope.catalog.technologies[0].onComplete.activateModifierIds, [modifier.id]);

  await projectService.setTechnologyProgress("entity-1", "tech-1", 5);
  assert.equal(modifier.active, true);
  validateEnvelopeIntegrity(envelope);
});

test("overview renders active and passive bonuses and penalties", () => {
  const template = readFileSync(new URL("../templates/research-app.hbs", import.meta.url), "utf8");
  assert.match(template, /overview\.bonuses/u);
  assert.match(template, /overview\.penalties/u);
  assert.match(template, /is-inactive/u);
  assert.match(template, /name="unlockTechnologyId"/u);
});

test("prerequisite navigation marks the destination for a seven-second highlight", () => {
  const template = readFileSync(new URL("../templates/research-app.hbs", import.meta.url), "utf8");
  const application = readFileSync(new URL("../scripts/app/research-app.mjs", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../styles/research-tech-tree.css", import.meta.url), "utf8");
  assert.match(template, /data-highlight-technology="true"/u);
  assert.match(template, /is-highlighted/u);
  assert.match(application, /7000/u);
  assert.match(stylesheet, /rtt-technology-highlight/u);
});

test("completed prerequisites remain marked in technology details", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  setGame({ users: [gm] });
  globalThis.game.user = gm;
  globalThis.game.users.activeGM = gm;
  const world = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{ id: "entity-1", name: "Academy", categoryIds: ["category-1"] }],
      categories: [{ id: "category-1", name: "Science", entityIds: ["entity-1"] }],
      technologies: [
        { id: "tech-completed", entityId: "entity-1", categoryId: "category-1", name: "Completed" },
        { id: "tech-pending", entityId: "entity-1", categoryId: "category-1", name: "Pending" },
        {
          id: "tech-target", entityId: "entity-1", categoryId: "category-1", name: "Target",
          prerequisiteIds: ["tech-completed", "tech-pending"]
        }
      ],
      modifiers: []
    },
    researchState: {
      completedTechnologyIdsByEntity: { "entity-1": ["tech-completed"] }
    },
    moduleConfig: {}
  });
  const uiState = {
    selectedEntityId: "entity-1",
    activeTabByEntity: { "entity-1": "category-1" },
    viewByTree: {},
    selectedTechnologyId: "tech-target",
    highlightedTechnologyId: "",
    searchQuery: "",
    editMode: false,
    editor: null,
    fullscreen: false
  };
  const context = await buildResearchContext({
    store: { snapshot: () => structuredClone(world) },
    uiState,
    weekService: { getMissingRolls: () => [] }
  });

  assert.equal(context.details.prerequisites.find(item => item.id === "tech-completed").completed, true);
  assert.equal(context.details.prerequisites.find(item => item.id === "tech-pending").completed, false);
  const template = readFileSync(new URL("../templates/research-app.hbs", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../styles/research-tech-tree.css", import.meta.url), "utf8");
  assert.match(template, /if completed.*is-completed/u);
  assert.match(stylesheet, /rtt-chip-link\.is-completed/u);
});

test("unlocks and modifier activators expose navigable highlighted technology links", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  setGame({ users: [gm] });
  globalThis.game.user = gm;
  globalThis.game.users.activeGM = gm;
  const world = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{
        id: "entity-1", name: "Institute", categoryIds: ["category-1", "category-2"],
        modifierIds: ["modifier-1"]
      }],
      categories: [
        { id: "category-1", name: "Foundations", entityIds: ["entity-1"] },
        { id: "category-2", name: "Applications", entityIds: ["entity-1"] }
      ],
      technologies: [
        {
          id: "tech-source", entityId: "entity-1", categoryId: "category-1", name: "Source",
          onComplete: { activateModifierIds: ["modifier-1"] }
        },
        { id: "tech-blocker", entityId: "entity-1", categoryId: "category-1", name: "Blocker" },
        {
          id: "tech-unlocked", entityId: "entity-1", categoryId: "category-2", name: "Unlocked",
          prerequisiteIds: ["tech-source"]
        },
        {
          id: "tech-locked", entityId: "entity-1", categoryId: "category-2", name: "Still Locked",
          prerequisiteIds: ["tech-source", "tech-blocker"]
        }
      ],
      modifiers: [{
        id: "modifier-1", entityId: "entity-1", name: "Research Bonus",
        active: true, operation: "add", target: "weeklyTotal", value: 1
      }]
    },
    researchState: {
      completedTechnologyIdsByEntity: { "entity-1": ["tech-source"] }
    },
    moduleConfig: {}
  });
  const context = await buildResearchContext({
    store: { snapshot: () => structuredClone(world) },
    uiState: {
      selectedEntityId: "entity-1",
      activeTabByEntity: { "entity-1": "category-1" },
      viewByTree: {},
      selectedTechnologyId: "tech-source",
      highlightedTechnologyId: "",
      searchQuery: "",
      editMode: false,
      editor: null,
      fullscreen: false
    },
    weekService: { getMissingRolls: () => [] }
  });

  assert.equal(context.details.unlocks.find(item => item.id === "tech-unlocked").unlocked, true);
  assert.equal(context.details.unlocks.find(item => item.id === "tech-locked").unlocked, false);
  assert.deepEqual(context.overview.bonuses[0].unlockTechnologies, [{
    id: "tech-source",
    name: "Source",
    categoryId: "category-1",
    completed: true
  }]);
  const template = readFileSync(new URL("../templates/research-app.hbs", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../styles/research-tech-tree.css", import.meta.url), "utf8");
  assert.match(template, /details\.unlocks.*data-highlight-technology="true"/su);
  assert.match(template, /unlockTechnologies\.length.*data-highlight-technology="true"/su);
  assert.match(template, /if unlocked.*is-unlocked/u);
  assert.match(stylesheet, /rtt-chip-link\.is-unlocked/u);
  assert.match(stylesheet, /rtt-modifier-unlock/u);
});

test("category tab scroll position is restored after application renders", () => {
  const template = readFileSync(new URL("../templates/research-app.hbs", import.meta.url), "utf8");
  const application = readFileSync(new URL("../scripts/app/research-app.mjs", import.meta.url), "utf8");
  assert.match(template, /data-rtt-category-tabs data-entity-id/u);
  assert.match(application, /categoryTabScrollByEntity/u);
  assert.match(application, /restoreCategoryTabScroll/u);
  assert.match(application, /categoryTabs\.scrollLeft = rememberedScrollLeft/u);
});

test("schema v3 migration derives success for existing SWADE roll records", () => {
  const migrated = migrateWorldEnvelope({
    schemaVersion: 3,
    catalog: { entities: [{ id: "entity-1" }] },
    researchState: {
      projects: [{
        id: "project-1",
        entityId: "entity-1",
        technologyId: "tech-1",
        weeklyRolls: { 1: { 1: { total: 7, mode: "swadeSkill" } } }
      }]
    },
    moduleConfig: {}
  });
  assert.equal(migrated.catalog.entities[0].rpOnSuccess, 1);
  assert.equal(migrated.researchState.projects[0].weeklyRolls[1][1].success, true);
  assert.equal(migrated.researchState.projects[0].weeklyRolls[1][1].bennyRerolls, 0);
  assert.equal(migrated.researchState.projects[0].weeklyRolls[1][1].lastRerollTotal, null);
});

test("v0.1.8 single-tree export preserves the selected tree's complete live state", () => {
  setGame({ users: [{ id: "gm", isGM: true }] });
  const world = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [
        { id: "entity-a", name: "Alpha", categoryIds: ["category-shared"], modifierIds: ["modifier-project"] },
        { id: "entity-b", name: "Beta", categoryIds: ["category-shared"] }
      ],
      categories: [{ id: "category-shared", name: "Industry", entityIds: ["entity-a", "entity-b"] }],
      technologies: [
        {
          id: "tech-a-base", entityId: "entity-a", categoryId: "category-shared",
          name: "Alpha Foundation", researchPointCost: 5
        },
        {
          id: "tech-a-active", entityId: "entity-a", categoryId: "category-shared",
          name: "Alpha Active", prerequisiteIds: ["tech-a-base"], researchPointCost: 10
        },
        { id: "tech-b", entityId: "entity-b", categoryId: "category-shared", name: "Beta Tech" }
      ],
      modifiers: [{
        id: "modifier-project", entityId: "entity-a", name: "Project Bonus",
        active: true, scopeType: "project", scopeId: "project-active", startWeek: 7, endWeek: 10
      }]
    },
    researchState: {
      currentWeek: 7,
      projects: [
        {
          id: "project-complete", entityId: "entity-a", technologyId: "tech-a-base",
          status: "completed", progress: 5, startedWeek: 3, completedWeek: 6
        },
        {
          id: "project-active", entityId: "entity-a", technologyId: "tech-a-active",
          status: "active", progress: 4, startedWeek: 7,
          engineers: [{ slot: 1, actorUuid: "Actor.alpha" }],
          weeklyRolls: { 7: { 1: {
            total: 9, points: 3, actorUuid: "Actor.alpha", requestId: "request-a",
            lastRequestId: "benny-a", mode: "swadeSkill", success: true, raiseCount: 1
          } } }
        }
      ],
      completedTechnologyIdsByEntity: { "entity-a": ["tech-a-base"] },
      history: [{
        id: "history-6", week: 6, processedAt: "2026-08-11T00:00:00.000Z",
        entities: [
          {
            entityId: "entity-a",
            projectResults: [{
              projectId: "project-complete", technologyId: "tech-a-base",
              appliedModifierIds: ["modifier-project"], progressAfter: 5, completed: true
            }],
            completedTechnologyIds: ["tech-a-base"]
          },
          { entityId: "entity-b", projectResults: [], completedTechnologyIds: [] }
        ]
      }],
      processedRequestIds: ["unrelated-request", "request-a", "benny-a"]
    },
    moduleConfig: {}
  });

  const exported = buildTreeExportEnvelope(world, "entity-a", { moduleVersion: "0.1.8" });
  assert.equal(exported.exportType, "technologyTree");
  assert.deepEqual(exported.catalog.entities.map(item => item.id), ["entity-a"]);
  assert.deepEqual(exported.catalog.technologies.map(item => item.id), ["tech-a-base", "tech-a-active"]);
  assert.deepEqual(exported.catalog.categories[0].entityIds, ["entity-a"]);
  assert.equal(exported.catalog.modifiers[0].scopeType, "project");
  assert.equal(exported.catalog.modifiers[0].scopeId, "project-active");
  assert.equal(exported.catalog.modifiers[0].active, true);
  assert.equal(exported.researchState.currentWeek, 7);
  assert.deepEqual(exported.researchState.projects, world.researchState.projects.filter(project => project.entityId === "entity-a"));
  assert.deepEqual(exported.researchState.completedTechnologyIdsByEntity, { "entity-a": ["tech-a-base"] });
  assert.deepEqual(exported.researchState.processedRequestIds, ["request-a", "benny-a"]);
  assert.deepEqual(exported.researchState.history[0].entities.map(summary => summary.entityId), ["entity-a"]);
  validateEnvelopeIntegrity(migrateWorldEnvelope(exported));
});

test("single-tree import preserves and remaps progress, completion, rolls, history, and project modifiers", () => {
  setGame({ users: [{ id: "gm", isGM: true }] });
  const current = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{ id: "entity-current", name: "Existing", categoryIds: ["category-current"] }],
      categories: [{ id: "category-current", name: "Existing Category", entityIds: ["entity-current"] }],
      technologies: [{ id: "tech-current", entityId: "entity-current", categoryId: "category-current", name: "Existing Tech" }],
      modifiers: []
    },
    researchState: {
      currentWeek: 9,
      history: [{
        id: "history-current", week: 8,
        entities: [{ entityId: "entity-current", projectResults: [], completedTechnologyIds: [] }]
      }],
      processedRequestIds: ["current-request"]
    },
    moduleConfig: {}
  });
  const imported = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{
        id: "entity-source", name: "Imported Tree", categoryIds: ["category-one", "category-two"],
        modifierIds: ["modifier-source"]
      }],
      categories: [
        { id: "category-one", name: "Foundations", entityIds: ["entity-source"] },
        { id: "category-two", name: "Advanced", entityIds: ["entity-source"] }
      ],
      technologies: [
        {
          id: "tech-one", entityId: "entity-source", categoryId: "category-one",
          name: "Foundation", researchPointCost: 10
        },
        {
          id: "tech-two", entityId: "entity-source", categoryId: "category-two", name: "Advanced Tech",
          prerequisiteIds: ["tech-one"], activatedModifierIds: ["modifier-source"],
          onComplete: { activateModifierIds: ["modifier-source"] }
        }
      ],
      modifiers: [{
        id: "modifier-source", entityId: "entity-source", name: "Advanced Bonus",
        active: true, scopeType: "project", scopeId: "project-two", startWeek: 7, endWeek: 10
      }]
    },
    researchState: {
      currentWeek: 7,
      projects: [
        {
          id: "project-one", entityId: "entity-source", technologyId: "tech-one",
          status: "completed", progress: 10, startedWeek: 2, completedWeek: 6
        },
        {
          id: "project-two", entityId: "entity-source", technologyId: "tech-two",
          status: "active", progress: 4, startedWeek: 7,
          engineers: [{ slot: 1, actorUuid: "Actor.imported" }],
          weeklyRolls: { 7: { 1: {
            total: 8, points: 3, actorUuid: "Actor.imported", requestId: "roll-request",
            mode: "swadeSkill", success: true, raiseCount: 1
          } } }
        }
      ],
      completedTechnologyIdsByEntity: { "entity-source": ["tech-one"] },
      history: [{
        id: "history-source", week: 6,
        entities: [{
          entityId: "entity-source",
          projectResults: [{
            projectId: "project-one", technologyId: "tech-one",
            appliedModifierIds: ["modifier-source"], progressAfter: 10, completed: true
          }],
          completedTechnologyIds: ["tech-one"]
        }]
      }],
      processedRequestIds: ["roll-request"]
    },
    moduleConfig: {}
  });
  let sequence = 0;
  const merged = mergeTreeIntoEnvelope(current, imported, {
    idFactory: prefix => `${prefix}-imported-${++sequence}`
  });

  assert.deepEqual(merged.envelope.catalog.entities[0], current.catalog.entities[0]);
  assert.deepEqual(merged.envelope.catalog.categories[0], current.catalog.categories[0]);
  assert.deepEqual(merged.envelope.catalog.technologies[0], current.catalog.technologies[0]);
  assert.equal(merged.envelope.researchState.currentWeek, 9);
  const newEntity = merged.envelope.catalog.entities.find(item => item.id === merged.entityId);
  const foundation = merged.envelope.catalog.technologies.find(item => item.name === "Foundation");
  const advanced = merged.envelope.catalog.technologies.find(item => item.name === "Advanced Tech");
  const bonus = merged.envelope.catalog.modifiers.find(item => item.name === "Advanced Bonus");
  const completedProject = merged.envelope.researchState.projects.find(project => project.technologyId === foundation.id);
  const activeProject = merged.envelope.researchState.projects.find(project => project.technologyId === advanced.id);
  assert.ok(newEntity);
  assert.notEqual(newEntity.id, "entity-source");
  assert.deepEqual(advanced.prerequisiteIds, [foundation.id]);
  assert.deepEqual(advanced.activatedModifierIds, [bonus.id]);
  assert.deepEqual(advanced.onComplete.activateModifierIds, [bonus.id]);
  assert.equal(bonus.active, true);
  assert.equal(bonus.scopeId, activeProject.id);
  assert.equal(bonus.startWeek, 9);
  assert.equal(bonus.endWeek, 12);
  assert.equal(completedProject.progress, 10);
  assert.equal(completedProject.completedWeek, 8);
  assert.equal(activeProject.progress, 4);
  assert.equal(activeProject.startedWeek, 9);
  assert.equal(activeProject.weeklyRolls[9][1].total, 8);
  assert.deepEqual(merged.envelope.researchState.completedTechnologyIdsByEntity[newEntity.id], [foundation.id]);
  assert.deepEqual(merged.envelope.researchState.processedRequestIds, ["current-request", "roll-request"]);
  const mergedHistory = merged.envelope.researchState.history.find(entry => entry.week === 8);
  const importedSummary = mergedHistory.entities.find(summary => summary.entityId === newEntity.id);
  assert.equal(mergedHistory.entities.length, 2);
  assert.equal(importedSummary.projectResults[0].projectId, completedProject.id);
  assert.equal(importedSummary.projectResults[0].technologyId, foundation.id);
  assert.deepEqual(importedSummary.projectResults[0].appliedModifierIds, [bonus.id]);
  assert.deepEqual(importedSummary.completedTechnologyIds, [foundation.id]);
  assert.ok(newEntity.categoryIds.every(id => id.startsWith("category-imported-")));
  validateEnvelopeIntegrity(merged.envelope);
});

test("full backup export and validation preserve the entire normalized world state", () => {
  setGame({ users: [{ id: "gm", isGM: true }] });
  const world = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{ id: "entity-1", name: "Exact State", categoryIds: ["category-1"] }],
      categories: [{ id: "category-1", name: "Science", entityIds: ["entity-1"] }],
      technologies: [{ id: "tech-1", entityId: "entity-1", categoryId: "category-1", researchPointCost: 20 }],
      modifiers: []
    },
    researchState: {
      currentWeek: 4,
      projects: [{ id: "project-1", entityId: "entity-1", technologyId: "tech-1", progress: 11, startedWeek: 2 }],
      history: [{ id: "history-3", week: 3, entities: [] }],
      processedRequestIds: ["request-1"]
    },
    moduleConfig: {}
  });
  const service = new ImportExportService({ snapshot: () => structuredClone(world) });
  const exported = service.createExportEnvelope(world);
  const restored = service.validateImportText(JSON.stringify(exported));

  assert.equal(exported.exportType, "fullBackup");
  assert.deepEqual(exported.catalog, world.catalog);
  assert.deepEqual(exported.researchState, world.researchState);
  assert.deepEqual(exported.moduleConfig, world.moduleConfig);
  assert.deepEqual(restored, world);
});

test("importing a newer tree snapshot advances the world week without backdating its state", () => {
  setGame({ users: [{ id: "gm", isGM: true }] });
  const current = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: { entities: [], categories: [], technologies: [], modifiers: [] },
    researchState: { currentWeek: 2 },
    moduleConfig: {}
  });
  const imported = migrateWorldEnvelope({
    schemaVersion: 5,
    catalog: {
      entities: [{ id: "entity-source", categoryIds: ["category-source"] }],
      categories: [{ id: "category-source", entityIds: ["entity-source"] }],
      technologies: [{ id: "tech-source", entityId: "entity-source", categoryId: "category-source" }],
      modifiers: []
    },
    researchState: {
      currentWeek: 6,
      projects: [{
        id: "project-source", entityId: "entity-source", technologyId: "tech-source",
        startedWeek: 5, weeklyRolls: { 6: {} }
      }]
    },
    moduleConfig: {}
  });
  let sequence = 0;
  const merged = mergeTreeIntoEnvelope(current, imported, {
    idFactory: prefix => `${prefix}-newer-${++sequence}`
  });
  const project = merged.envelope.researchState.projects[0];

  assert.equal(merged.envelope.researchState.currentWeek, 6);
  assert.equal(project.startedWeek, 5);
  assert.ok(project.weeklyRolls[6]);
  validateEnvelopeIntegrity(merged.envelope);
});

test("tree import rejects files containing more than one entity", () => {
  setGame();
  assert.throws(() => mergeTreeIntoEnvelope({ catalog: {}, researchState: {} }, {
    catalog: { entities: [{ id: "one" }, { id: "two" }] }
  }));
});
