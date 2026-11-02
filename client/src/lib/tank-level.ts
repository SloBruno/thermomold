// Operator-provided endpoints: distance decreases as the tank fills.
export const TANK_EMPTY_MM = 333
export const TANK_FULL_MM = 270
export function tankLevelPercent(distanceMm?: number): number | undefined {
  if (distanceMm === undefined || !Number.isFinite(distanceMm)) return undefined
  return Math.max(0, Math.min(100, (distanceMm - TANK_EMPTY_MM) * 100 / (TANK_FULL_MM - TANK_EMPTY_MM)))
}
