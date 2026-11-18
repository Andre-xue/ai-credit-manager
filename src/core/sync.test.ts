import { describe, expect, it } from 'vitest'
import { errMsg } from './sync'

describe('sync.errMsg 错误文本提取', () => {
  it('普通字符串原样返回', () => {
    expect(errMsg('网络错误')).toBe('网络错误')
  })

  it('Error 对象取 message', () => {
    expect(errMsg(new Error('连接超时'))).toBe('连接超时')
  })

  it('云 SDK 的 {message} 对象', () => {
    expect(errMsg({ message: 'permission denied' })).toBe('permission denied')
  })

  it('嵌套 {error:{message}} 对象', () => {
    expect(errMsg({ error: { message: 'row level security 拒绝' } })).toBe('row level security 拒绝')
  })

  it('message 本身是对象时不返回 [object Object]', () => {
    const out = errMsg({ message: { detail: 'RLS 策略拦截' } })
    expect(out).not.toBe('[object Object]')
    expect(out).toContain('RLS 策略拦截')
  })

  it('空错误给出可读兜底', () => {
    expect(errMsg({})).toBeTruthy()
    expect(errMsg({})).not.toContain('[object Object]')
    expect(errMsg(null)).toBeTruthy()
  })
})
