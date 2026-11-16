import { describe, it, expect } from 'vitest'
import { inQuietHours } from './notify'

describe('inQuietHours', () => {
  const at = (h: number, m: number) => new Date(2026, 0, 1, h, m)

  it('未设置时段时不免打扰', () => {
    expect(inQuietHours('', '', at(10, 0))).toBe(false)
    expect(inQuietHours('22:00', '22:00', at(23, 0))).toBe(false)
  })

  it('普通时段：22:00-08:00 内的夜间命中', () => {
    expect(inQuietHours('22:00', '08:00', at(23, 30))).toBe(true)
    expect(inQuietHours('22:00', '08:00', at(3, 0))).toBe(true)
    expect(inQuietHours('22:00', '08:00', at(7, 59))).toBe(true)
  })

  it('普通时段：边界外不命中', () => {
    expect(inQuietHours('22:00', '08:00', at(8, 0))).toBe(false)
    expect(inQuietHours('22:00', '08:00', at(21, 59))).toBe(false)
    expect(inQuietHours('22:00', '08:00', at(12, 0))).toBe(false)
  })

  it('不跨午夜时段：09:00-18:00', () => {
    expect(inQuietHours('09:00', '18:00', at(10, 0))).toBe(true)
    expect(inQuietHours('09:00', '18:00', at(18, 0))).toBe(false)
    expect(inQuietHours('09:00', '18:00', at(20, 0))).toBe(false)
  })
})
