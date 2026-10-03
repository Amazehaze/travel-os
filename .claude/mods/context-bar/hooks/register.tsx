import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Segment, Snapshot } from '../types'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const isShown = atom({ plugin: 'context-bar', key: 'isShown' } as const, true)

const STORE_KEY = 'isShown'

// Split `width` cells among segments by tokens, largest remainder, so the
// cells always add up to `width` and any non-empty used row gets at least one.
export function cells(segments: Segment[], total: number, width: number): number[] {
  if (total <= 0 || width <= 0) return segments.map(() => 0)
  const exact = segments.map(s => (s.tokens / total) * width)
  const out = exact.map(Math.floor)
  segments.forEach((s, i) => {
    if (!s.isFree && s.tokens > 0 && out[i] === 0) out[i] = 1
  })
  let left = width - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => ({ i, rem: x - Math.floor(x) })).sort((a, b) => b.rem - a.rem)
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) {
    out[order[k]!.i]! += 1
  }
  // Rounding minimums up can overshoot: take it back from the largest cells.
  while (left < 0) {
    const big = out.indexOf(Math.max(...out))
    out[big]! -= 1
    left++
  }
  return out
}

function fmt(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return
  const segments: Segment[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name, tokens: c.tokens, color: c.color, isFree: c.kind === 'free' }))
  await update($, snapshot, () => ({
    segments,
    totalTokens: b.totalTokens,
    maxTokens: b.rawMaxTokens,
    percentage: b.percentage,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Toggle the context-window bar above the prompt',
    })
    const saved = await $.store.get(STORE_KEY)
    if (typeof saved === 'boolean') await update($, isShown, () => saved)
    const result = await next(e)
    void refresh($).catch(() => {})
    return result
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const shown = !(await read($, isShown))
    await update($, isShown, () => shown)
    await $.store.set(STORE_KEY, shown)
    if (shown) await refresh($).catch(() => {})
    return { text: shown ? 'Context bar on.' : 'Context bar off.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => {})
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    void refresh($).catch(() => {})
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) return next(e)
    const snap: Snapshot | null = await read($, snapshot)
    if (!snap || snap.segments.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns - 2)
    const total = snap.segments.reduce((a, s) => a + s.tokens, 0)
    const widths = cells(snap.segments, total, width)

    return (
      <Box flexDirection="column">
        <Box key="bar">
          <Text>
            {snap.segments.map((s, i) =>
              widths[i]! > 0 ? (
                <Text color={s.color} dimColor={s.isFree}>
                  {(s.isFree ? '░' : '█').repeat(widths[i]!)}
                </Text>
              ) : null,
            )}
          </Text>
        </Box>
        <Box key="legend">
          <Text wrap="truncate-end">
            <Text dimColor>
              {fmt(snap.totalTokens)}/{fmt(snap.maxTokens)} ({snap.percentage}%){'  '}
            </Text>
            {snap.segments.map(s => (
              <Text>
                <Text color={s.color}>{s.isFree ? '░' : '█'}</Text>
                <Text dimColor>
                  {' '}
                  {s.name} {fmt(s.tokens)}{'  '}
                </Text>
              </Text>
            ))}
          </Text>
        </Box>
      </Box>
    )
  })
}
