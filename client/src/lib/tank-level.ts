// Operator-provided endpoints, intentionally increasing with distance.
export const TANK_EMPTY_MM = 263
export const TANK_FULL_MM = 267
export function tankLevelPercent(distanceMm?: number): number | undefined {
  if (distanceMm === undefined || !Number.isFinite(distanceMm)) return undefined
  return Math.max(0, Math.min(100, (distanceMm - TANK_EMPTY_MM) * 100 / (TANK_FULL_MM - TANK_EMPTY_MM)))
}
