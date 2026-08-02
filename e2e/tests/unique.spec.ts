import { test, expect } from '@playwright/test'
import { unique } from './fixtures/ids'

test('unique() generates distinct, well-formed values', () => {
  const values = new Set<string>()
  for (let i = 0; i < 1000; i++) {
    const v = unique('x')
    expect(v).toMatch(/^x-\d+-\d+-\d+$/)
    expect(values.has(v)).toBe(false)
    values.add(v)
  }
  expect(values.size).toBe(1000)
})

test('unique() differs even within the same millisecond', async () => {
  const a = unique('p')
  const b = unique('p')
  expect(a).not.toBe(b)
})
