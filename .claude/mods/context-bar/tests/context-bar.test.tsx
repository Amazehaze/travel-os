import { expect, mock, test } from 'claude-code/testing'

import { cells } from '../hooks/register'

const seg = (name: string, tokens: number, isFree = false) => ({
  name,
  tokens,
  color: 'text',
  isFree,
})

const USAGE = {
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 200_000,
    tokens: 50_000,
    percent: 25,
    breakdown: {
      categories: [
        {
          name: 'System prompt',
          tokens: 10_000,
          color: 'promptBorder',
          isDeferred: false,
          kind: 'used',
        },
        { name: 'Messages', tokens: 40_000, color: 'permission', isDeferred: false, kind: 'used' },
        { name: 'MCP tools', tokens: 9_000, color: 'warning', isDeferred: true, kind: 'deferred' },
        { name: 'Free space', tokens: 150_000, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: 50_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model-default',
      percentage: 25,
      gridRows: [],
      model: 'test',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
}

test('cells fill the width exactly and keep tiny rows visible', async () => {
  const w = cells([seg('a', 1), seg('b', 500), seg('free', 99_499, true)], 100_000, 40)
  expect(w.reduce((a, b) => a + b, 0)).toBe(40)
  expect(w[0]).toBe(1)
})

test('/context-bar toggles the band, which shows each category', async ($, on) => {
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e as never)
    return h(Box, { key: 'engine' }) as never
  }) // stands for the engine's own (empty) band
  on('session.usage', () => ({ value: USAGE }) as never)
  const run = (args = '') =>
    $.command.run({
      command: 'context-bar',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const mount = () =>
      $.ui.mount({
        plugin: 'context-bar',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
      })

    // Default on, but nothing measured yet: toggle off then on to measure.
    expect(((await run()) as { text: string }).text).toBe('Context bar off.')
    let ui = await mount()
    expect(await ui.find({ key: 'bar' })).toBeUndefined()
    await ui.unmount()

    expect(((await run()) as { text: string }).text).toBe('Context bar on.')
    ui = await mount()
    const legend = await ui.find({ key: 'legend' })
    expect(legend?.text).toContain('System prompt')
    expect(legend?.text).toContain('Messages')
    expect(legend?.text).not.toContain('MCP tools')
    expect(legend?.text).toContain('50.0k/200.0k (25%)')
    expect(await ui.find({ key: 'bar' })).toBeDefined()
    await ui.unmount()
  }
})
