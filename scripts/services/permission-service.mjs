import { TECHNOLOGY_VISIBILITY, localize } from "../constants.mjs";
import { technologyVisibleToPlayer } from "../utils/graph-utils.mjs";

export function usersArray() {
  return [...(globalThis.game?.users ?? [])];
}

export function getUser(userId) {
  return game.users?.get?.(userId) ?? usersArray().find(user => user.id === userId) ?? null;
}

export function requireKnownUser(userId) {
  const user = getUser(userId);
  if (!user) throw new Error(localize("Errors.UserNotFound"));
  return user;
}

export function requireGM(user) {
  if (!user?.isGM) throw new Error(localize("Errors.GMOnly"));
  return user;
}

export function canViewEntity(user, entity) {
  if (!user || !entity) return false;
  return Boolean(user.isGM || entity.public || entity.allowedUserIds?.includes(user.id));
}

export function requireEntityAccess(user, entity) {
  if (!canViewEntity(user, entity)) throw new Error(localize("Errors.EntityAccess"));
  return entity;
}

export function canViewTechnology(user, entity, technology, state) {
  if (!canViewEntity(user, entity) || !technology) return false;
  if (user.isGM) return true;
  if (technology.visibility === TECHNOLOGY_VISIBILITY.HIDDEN) return false;
  return technologyVisibleToPlayer(technology, state);
}

export async function resolveActor(actorUuid) {
  if (!actorUuid) return null;
  const resolver = globalThis.foundry?.utils?.fromUuid ?? globalThis.fromUuid;
  if (typeof resolver !== "function") return null;
  const document = await resolver(actorUuid);
  if (!document || document.documentName !== "Actor") return null;
  return document;
}

export function userOwnsActor(user, actor) {
  if (!user || !actor) return false;
  if (user.isGM) return true;
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return Boolean(actor.testUserPermission?.(user, ownerLevel));
}

export async function validateEngineerRollPermission({
  user,
  entity,
  technology,
  researchState,
  project,
  engineerSlot,
  actorUuid
}) {
  requireEntityAccess(user, entity);
  if (!canViewTechnology(user, entity, technology, researchState)) {
    throw new Error(localize("Errors.TechnologyAccess"));
  }
  const slot = Number(engineerSlot);
  if (![1, 2].includes(slot)) throw new Error(localize("Errors.InvalidEngineerSlot"));
  const assignment = project?.engineers?.find(engineer => engineer.slot === slot);
  if (!assignment?.actorUuid || assignment.actorUuid !== actorUuid) {
    throw new Error(localize("Errors.EngineerAssignmentChanged"));
  }
  const actor = await resolveActor(assignment.actorUuid);
  if (!actor) throw new Error(localize("Errors.MissingActor"));
  if (!userOwnsActor(user, actor)) throw new Error(localize("Errors.ActorOwnership"));
  return { actor, assignment, slot };
}
