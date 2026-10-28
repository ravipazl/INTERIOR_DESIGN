import { Configuration, configDimUnit } from "@pazl/main/core/configuration.js";
import { dimCentiMeter, dimFeetAndInch, dimInch, dimMeter, dimMilliMeter } from "@pazl/main/core/constants.js";

/** The units a known length can be typed in, centimetres per unit. */
export const LENGTH_UNITS: { id: string; label: string; cm: number }[] = [
  { id: dimMilliMeter, label: "mm", cm: 0.1 },
  { id: dimCentiMeter, label: "cm", cm: 1 },
  { id: dimMeter, label: "m", cm: 100 },
  { id: dimFeetAndInch, label: "ft", cm: 30.48 },
];
const INCH_CM = 2.54;

/** The plan's display unit, as one of LENGTH_UNITS (inches are typed as feet). */
export const defaultLengthUnit = (): string => {
  const u = Configuration.getStringValue(configDimUnit);
  if (u === dimInch) return dimFeetAndInch;
  return LENGTH_UNITS.some((x) => x.id === u) ? u : dimMilliMeter;
};

export const isFeet = (unit: string) => unit === dimFeetAndInch;

/**
 * A typed length in cm, or null. Feet also take feet-and-inches: 11'6" or
 * 11' 6 or 11 6.
 */
export const lengthToCm = (text: string, unit: string): number | null => {
  const t = String(text || "").trim();
  if (!t) return null;
  if (unit === dimFeetAndInch) {
    const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i);
    if (!m) return null;
    const cm = Number(m[1]) * 30.48 + (m[2] ? Number(m[2]) * INCH_CM : 0);
    return cm > 0 ? cm : null;
  }
  const v = Number(t.replace(",", "."));
  const u = LENGTH_UNITS.find((x) => x.id === unit);
  return u && Number.isFinite(v) && v > 0 ? v * u.cm : null;
};
