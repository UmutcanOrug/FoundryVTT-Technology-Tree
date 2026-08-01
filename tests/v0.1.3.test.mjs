import test from "node:test";
import assert from "node:assert/strict";

import { ACTIONS, ActionService } from "../scripts/services/action-service.mjs";
import {
  ensureRollEvaluated,
  RollService,
  swadeRaiseCount,
  swadeResearchAward
} from "../scripts/services/roll-service.mjs";
import {
  resolveResearchSkill,
  worldResearchSkillChoices
} from "../scripts/services/swade-skill-service.mjs";
import { migrateWorldEnvelope } from "../scripts/store/migrations.mjs";

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
        id: "entity-1", public: true, allowedUserIds: [], researchSkill: "science",
        researchSkillName: "Nanobilim (Özel)", rpOnSuccess: 2, rpPerRaise: 3
      }],
      technologies: [{ id: "tech-1", visibility: "public", name: "Nano Tech" }]
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

test("schema v2 data migrates to v4 with safe entity and roll defaults", () => {
  const migrated = migrateWorldEnvelope({
    schemaVersion: 2,
    catalog: { entities: [{ id: "entity-1", name: "Legacy" }] },
    researchState: {},
    moduleConfig: {}
  });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.catalog.entities[0].rpOnSuccess, 1);
  assert.equal(migrated.catalog.entities[0].rpPerRaise, 1);
  assert.equal(migrated.catalog.entities[0].researchSkillName, "");
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
});
