import test from "node:test";
import assert from "node:assert/strict";

import { ACTIONS, ActionService } from "../scripts/services/action-service.mjs";
import { RollService, swadeRaiseCount } from "../scripts/services/roll-service.mjs";
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

test("SWADE rolls persist raises and per-organization RP", async () => {
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
        total: 12,
        formula: "1d10x",
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
        researchSkillName: "Nanobilim (Özel)", rpPerRaise: 3
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
  assert.equal(record.points, 6);
  assert.equal(envelope.researchState.projects[0].weeklyRolls[1][1].points, 6);
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

test("schema v2 data migrates to v3 with safe entity and roll defaults", () => {
  const migrated = migrateWorldEnvelope({
    schemaVersion: 2,
    catalog: { entities: [{ id: "entity-1", name: "Legacy" }] },
    researchState: {},
    moduleConfig: {}
  });
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.catalog.entities[0].rpPerRaise, 1);
  assert.equal(migrated.catalog.entities[0].researchSkillName, "");
});
