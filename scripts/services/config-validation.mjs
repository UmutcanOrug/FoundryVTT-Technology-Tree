import { localize } from "../constants.mjs";

export function validateModuleConfig(config) {
  let previousMax = -Infinity;
  for (const band of config?.resultBands ?? []) {
    if (![band.min, band.max, band.points].every(Number.isFinite)
      || band.min <= previousMax
      || band.max < band.min
      || band.points < 0) {
      throw new Error(localize("Errors.ResultBands"));
    }
    previousMax = band.max;
  }

  const formula = String(config?.engineeringFormula ?? "").trim();
  const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
  if (!formula || (typeof RollClass?.validate === "function" && !RollClass.validate(formula))) {
    throw new Error(localize("Errors.InvalidFormula", { formula: formula || "—" }));
  }
  return true;
}
