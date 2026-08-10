export const DEFAULT_RESEARCH_SKILL = "engineering";

export function technologyResearchSkill(entity = {}, technology = {}) {
  const technologySkill = normalizeSkillKey(technology?.researchSkill);
  if (technologySkill) {
    return {
      researchSkill: technologySkill,
      researchSkillName: String(technology?.researchSkillName ?? "").trim()
    };
  }
  return {
    researchSkill: normalizeSkillKey(entity?.researchSkill) || DEFAULT_RESEARCH_SKILL,
    researchSkillName: String(entity?.researchSkillName ?? "").trim()
  };
}

export function resolveResearchSkill(actor, configuredSkill = DEFAULT_RESEARCH_SKILL, configuredName = "") {
  const key = normalizeSkillKey(configuredSkill);
  const name = normalizeSkillName(configuredName);
  if (!actor || (!key && !name)) return null;
  const skills = actorItems(actor).filter(item => item?.type === "skill");

  if (name) {
    const exactName = skills.find(skill => normalizeSkillName(skill.name) === name);
    const exactPair = skills.find(skill => normalizeSkillKey(skill.system?.swid) === key
      && normalizeSkillName(skill.name) === name);
    const slugName = skillSlug(configuredName);
    const slugMatch = skills.find(skill => skillSlug(skill.name) === slugName);
    return exactPair ?? exactName ?? slugMatch
      ?? skills.find(skill => normalizeSkillKey(skill.system?.swid) === key)
      ?? null;
  }

  return skills.find(skill => normalizeSkillKey(skill.system?.swid) === key)
    ?? skills.find(skill => skillSlug(skill.name) === key)
    ?? null;
}

export function worldResearchSkillChoices(selectedSkill = DEFAULT_RESEARCH_SKILL, selectedName = "") {
  const selectedKey = normalizeSkillKey(selectedSkill) || DEFAULT_RESEARCH_SKILL;
  const selectedLabel = String(selectedName ?? "").trim();
  const selectedNameKey = normalizeSkillName(selectedLabel);
  const choicesByIdentity = new Map();

  for (const actor of collectionValues(globalThis.game?.actors)) {
    for (const skill of actorItems(actor).filter(item => item?.type === "skill")) {
      const value = skillKey(skill);
      const label = String(skill.name ?? value).trim();
      if (!value || !label) continue;
      const identity = choiceIdentity(value, label);
      if (choicesByIdentity.has(identity)) continue;
      choicesByIdentity.set(identity, { value, label, skillName: label, identity });
    }
  }

  let selectedIdentity = selectedNameKey ? choiceIdentity(selectedKey, selectedLabel) : "";
  if (selectedIdentity && !choicesByIdentity.has(selectedIdentity)) {
    choicesByIdentity.set(selectedIdentity, {
      value: selectedKey,
      label: selectedLabel,
      skillName: selectedLabel,
      identity: selectedIdentity
    });
  }
  if (!selectedIdentity) {
    selectedIdentity = [...choicesByIdentity.values()]
      .find(choice => choice.value === selectedKey)?.identity ?? "";
  }
  if (!selectedIdentity) {
    const label = selectedLabel || humanizeSkillKey(selectedKey);
    selectedIdentity = choiceIdentity(selectedKey, label);
    choicesByIdentity.set(selectedIdentity, {
      value: selectedKey,
      label,
      skillName: label,
      identity: selectedIdentity
    });
  }

  return [...choicesByIdentity.values()]
    .sort((left, right) => left.label.localeCompare(right.label, globalThis.game?.i18n?.lang ?? "en"))
    .map(({ identity, ...choice }) => ({ ...choice, selected: identity === selectedIdentity }));
}

export function researchSkillLabel(configuredSkill = DEFAULT_RESEARCH_SKILL, configuredName = "") {
  const selectedName = String(configuredName ?? "").trim();
  if (selectedName) return selectedName;
  const selected = normalizeSkillKey(configuredSkill) || DEFAULT_RESEARCH_SKILL;
  return worldResearchSkillChoices(selected).find(choice => choice.selected)?.label
    ?? humanizeSkillKey(selected);
}

export function normalizeSkillKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function normalizeSkillName(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function choiceIdentity(value, label) {
  return `${normalizeSkillKey(value)}\u0000${normalizeSkillName(label)}`;
}

function skillKey(skill) {
  const swid = normalizeSkillKey(skill?.system?.swid);
  return swid && swid !== "none" ? swid : skillSlug(skill?.name);
}

function skillSlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function humanizeSkillKey(value) {
  const words = String(value ?? "").replaceAll("-", " ").trim();
  return words ? words.replace(/(^|\s)\S/gu, match => match.toLocaleUpperCase()) : DEFAULT_RESEARCH_SKILL;
}

function actorItems(actor) {
  return collectionValues(actor?.items);
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return [...collection.values()];
  return typeof collection[Symbol.iterator] === "function" ? [...collection] : [];
}
