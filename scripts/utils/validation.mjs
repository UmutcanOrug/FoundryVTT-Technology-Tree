export function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function asString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function asNumber(value, fallback = 0, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function asInteger(value, fallback = 0, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.trunc(number);
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  return Math.min(max, Math.max(min, integer));
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function uniqueStrings(value) {
  return [...new Set(asArray(value).map(item => asString(item)).filter(Boolean))];
}

export function asEnum(value, allowed, fallback) {
  return Object.values(allowed).includes(value) ? value : fallback;
}

export function createStableId(prefix = "rtt") {
  const random = globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

export function parseStringList(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  return [...new Set(String(value ?? "")
    .split(/[,;\n]/u)
    .map(item => item.trim())
    .filter(Boolean))];
}

export function parseJson(value, label = "JSON") {
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function hasUniqueIds(items) {
  if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== "string" || !item.id.trim())) return false;
  const ids = items.map(item => item.id);
  return ids.length === new Set(ids).size;
}

export function escapeHtml(value) {
  const text = String(value ?? "");
  if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function slugForFilename(value) {
  return String(value ?? "research-tech-tree")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase() || "research-tech-tree";
}
