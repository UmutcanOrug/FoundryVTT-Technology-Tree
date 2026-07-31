import { DEFAULT_ENTITY_ICON, DEFAULT_TECH_ICON } from "../constants.mjs";
import { createStableId } from "../utils/validation.mjs";

export function createDemoEnvelopeData() {
  const countryId = createStableId("entity");
  const facilityId = createStableId("entity");
  const tankCategoryId = createStableId("category");
  const industryCategoryId = createStableId("category");
  const artilleryCategoryId = createStableId("category");
  const oldEquipmentId = createStableId("modifier");
  const artilleryBonusId = createStableId("modifier");

  const basicTankId = createStableId("technology");
  const mediumTankId = createStableId("technology");
  const standardizedPartsId = createStableId("technology");
  const fieldArtilleryId = createStableId("technology");
  const measurementId = createStableId("technology");
  const opticsId = createStableId("technology");

  return {
    catalog: {
      entities: [
        {
          id: countryId,
          type: "country",
          name: "Auran Republic",
          icon: "icons/svg/flag.svg",
          banner: "",
          description: "A growing industrial nation with a doctrine built around reliable machines.",
          lore: "The republic established a national research council after the Border War.",
          public: true,
          allowedUserIds: [],
          categoryIds: [tankCategoryId, industryCategoryId, artilleryCategoryId],
          modifierIds: [],
          basePointsPerWorker: 2,
          maxConcurrentProjects: 2,
          sortOrder: 0
        },
        {
          id: facilityId,
          type: "facility",
          name: "Auran Imperial Research Facility",
          icon: DEFAULT_ENTITY_ICON,
          banner: "",
          description: "An aging but ambitious complex focused on measurement and artillery science.",
          lore: "Several wings still use pre-war laboratory equipment.",
          public: true,
          allowedUserIds: [],
          categoryIds: [industryCategoryId, artilleryCategoryId],
          modifierIds: [oldEquipmentId, artilleryBonusId],
          basePointsPerWorker: 1,
          maxConcurrentProjects: 2,
          sortOrder: 1
        }
      ],
      categories: [
        { id: tankCategoryId, name: "Tanks", icon: "fa-solid fa-truck-monster", description: "Armored vehicle development.", entityIds: [countryId], sortOrder: 0 },
        { id: industryCategoryId, name: "Industry", icon: "fa-solid fa-industry", description: "Production and laboratory infrastructure.", entityIds: [countryId, facilityId], sortOrder: 1 },
        { id: artilleryCategoryId, name: "Artillery", icon: "fa-solid fa-bullseye", description: "Guns, optics, and fire-control systems.", entityIds: [countryId, facilityId], sortOrder: 2 }
      ],
      technologies: [
        technology({ id: basicTankId, entityId: countryId, categoryId: tankCategoryId, name: "Basic Tank Chassis", cost: 35, x: 80, y: 150 }),
        technology({ id: mediumTankId, entityId: countryId, categoryId: tankCategoryId, name: "Medium Tank Doctrine", cost: 80, x: 390, y: 150, prerequisites: [basicTankId] }),
        technology({ id: standardizedPartsId, entityId: countryId, categoryId: industryCategoryId, name: "Industrial Standardization", cost: 45, x: 120, y: 110 }),
        technology({ id: fieldArtilleryId, entityId: countryId, categoryId: artilleryCategoryId, name: "Modern Field Artillery", cost: 70, x: 140, y: 130, prerequisites: [standardizedPartsId] }),
        technology({ id: measurementId, entityId: facilityId, categoryId: industryCategoryId, name: "Precision Measurement", cost: 40, x: 90, y: 130 }),
        technology({
          id: opticsId,
          entityId: facilityId,
          categoryId: artilleryCategoryId,
          name: "Modern Optical Equipment",
          cost: 75,
          x: 360,
          y: 130,
          prerequisites: [measurementId],
          activate: [artilleryBonusId],
          deactivate: [oldEquipmentId]
        })
      ],
      modifiers: [
        {
          id: oldEquipmentId,
          entityId: facilityId,
          name: "Old Laboratory Equipment",
          description: "Old laboratory equipment causes a weekly loss of 3 research points.",
          active: true,
          source: "Facility Condition",
          operation: "add",
          target: "weeklyTotal",
          scopeType: "all",
          scopeId: "",
          value: -3,
          startWeek: null,
          endWeek: null
        },
        {
          id: artilleryBonusId,
          entityId: facilityId,
          name: "Modern Optics",
          description: "Artillery research gains a 15 percent weekly bonus.",
          active: false,
          source: "Modern Optical Equipment",
          operation: "multiply",
          target: "weeklyTotal",
          scopeType: "category",
          scopeId: artilleryCategoryId,
          value: 1.15,
          startWeek: null,
          endWeek: null
        }
      ]
    },
    researchState: {
      currentWeek: 1,
      projects: [{
        id: createStableId("project"),
        entityId: facilityId,
        technologyId: measurementId,
        status: "active",
        progress: 5,
        assignedWorkers: 6,
        engineers: [{ slot: 1, actorUuid: null }, { slot: 2, actorUuid: null }],
        weeklyRolls: {},
        startedWeek: 1,
        completedWeek: null,
        paused: false
      }],
      completedTechnologyIdsByEntity: {},
      history: [],
      processedRequestIds: []
    }
  };
}

function technology({ id, entityId, categoryId, name, cost, x, y, prerequisites = [], activate = [], deactivate = [] }) {
  return {
    id,
    entityId,
    categoryId,
    name,
    icon: DEFAULT_TECH_ICON,
    description: `${name} research program.`,
    researchPointCost: cost,
    x,
    y,
    prerequisiteIds: prerequisites,
    tags: [],
    visibility: "public",
    repeatable: false,
    activatedModifierIds: [],
    onComplete: { activateModifierIds: activate, deactivateModifierIds: deactivate },
    sortOrder: 0
  };
}
