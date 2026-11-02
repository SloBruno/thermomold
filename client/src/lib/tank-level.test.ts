import { expect, test } from 'vitest'
import { tankLevelPercent } from './tank-level'
test('operator endpoints and midpoint are preserved exactly',()=>{
 expect(tankLevelPercent(333)).toBe(0)
 expect(tankLevelPercent((333+270)/2)).toBe(50)
 expect(tankLevelPercent(270)).toBe(100)
})
test('clamps without inventing a reading when unavailable',()=>{
 expect(tankLevelPercent(400)).toBe(0)
 expect(tankLevelPercent(200)).toBe(100)
 expect(tankLevelPercent(undefined)).toBeUndefined()
 expect(tankLevelPercent(NaN)).toBeUndefined()
})
