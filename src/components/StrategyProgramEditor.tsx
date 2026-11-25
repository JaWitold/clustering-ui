import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as Blockly from 'blockly'
import { fixtureCatalog } from '../strategyLanguage/catalog'
import { CONNECTION_CHECKER, defineBlocks, foldNegations, toolbox } from '../strategyLanguage/blocks'
import { astToState, stateToAst, type Hole, type WorkspaceState } from '../strategyLanguage/mapping'
import type { Program } from '../strategyLanguage/ast'

const CORPUS = '../../fixtures/data/strategy-language/corpus/valid/'
const asts = import.meta.glob<Program>('../../fixtures/data/strategy-language/corpus/valid/*.ast.json', { eager: true, import: 'default' })
const texts = import.meta.glob<string>('../../fixtures/data/strategy-language/corpus/valid/*.canonical.sl', { eager: true, query: '?raw', import: 'default' })
const examples = Object.keys(asts).map((path) => path.slice(CORPUS.length, -'.ast.json'.length)).sort()

const EMPTY: Program = {
  type: 'program',
  version: 1,
  constants: [],
  statements: [],
  result: { type: 'return', value: { type: 'action', cut: null, hike: null }, comment: null },
}

const theme = Blockly.Theme.defineTheme('strategy_language_dark', {
  name: 'strategy_language_dark',
  base: Blockly.Themes.Zelos,
  componentStyles: {
    workspaceBackgroundColour: '#020617',
    toolboxBackgroundColour: '#0f172a',
    toolboxForegroundColour: '#e2e8f0',
    flyoutBackgroundColour: '#1e293b',
    flyoutForegroundColour: '#e2e8f0',
    flyoutOpacity: 0.95,
    scrollbarColour: '#475569',
    insertionMarkerColour: '#ffffff',
    insertionMarkerOpacity: 0.3,
  },
})

export const StrategyProgramEditor: React.FC = () => {
  const container = useRef<HTMLDivElement>(null)
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null)
  const [example, setExample] = useState('14-standard-program')
  const [panel, setPanel] = useState<'ast' | 'text'>('ast')
  const [ast, setAst] = useState<Program | null>(null)
  const [holes, setHoles] = useState<Hole[]>([])

  useEffect(() => {
    if (!container.current) return
    defineBlocks(fixtureCatalog)
    const injected = Blockly.inject(container.current, {
      toolbox: toolbox(fixtureCatalog),
      renderer: 'zelos',
      theme,
      plugins: { connectionChecker: CONNECTION_CHECKER },
      zoom: { controls: true, wheel: true, startScale: 0.75 },
      trashcan: true,
    })
    workspace.current = injected

    const flagged = new Set<string>()
    const refresh = (event: Blockly.Events.Abstract) => {
      if (event.isUiEvent || injected.isDragging()) return
      if (event.type === Blockly.Events.BLOCK_MOVE || event.type === Blockly.Events.BLOCK_CREATE) foldNegations(injected)
      const result = stateToAst(Blockly.serialization.workspaces.save(injected) as WorkspaceState)
      const empty = new Map<string, string[]>()
      for (const hole of result.holes) if (hole.blockId) empty.set(hole.blockId, [...(empty.get(hole.blockId) ?? []), hole.input])
      for (const id of new Set([...flagged, ...empty.keys()])) {
        injected.getBlockById(id)?.setWarningText(empty.has(id) ? `Empty: ${empty.get(id)?.join(', ')}` : null)
      }
      flagged.clear()
      for (const id of empty.keys()) flagged.add(id)
      setAst(result.ast)
      setHoles(result.holes)
    }
    injected.addChangeListener(Blockly.Events.disableOrphans)
    injected.addChangeListener(refresh)
    return () => injected.dispose()
  }, [])

  useEffect(() => {
    const target = workspace.current
    if (!target) return
    Blockly.serialization.workspaces.load(astToState(asts[`${CORPUS}${example}.ast.json`] ?? EMPTY), target)
    // the program block is the program: it cannot be deleted
    target.getBlocksByType('sl_program')[0]?.setDeletable(false)
    target.scroll(0, 0)
  }, [example])

  const loaded = asts[`${CORPUS}${example}.ast.json`] ?? EMPTY
  const unchanged = useMemo(() => JSON.stringify(ast) === JSON.stringify(loaded), [ast, loaded])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Strategy program editor</h2>
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">prototype: fixtures only, nothing is saved</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
          Program
          <select
            value={example}
            onChange={(event) => setExample(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
          >
            <option value="">new program</option>
            {examples.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div ref={container} className="h-[70vh] overflow-hidden rounded-lg border border-slate-800" />

        <div className="flex h-[70vh] flex-col rounded-lg border border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-1 border-b border-slate-800 p-2 text-sm">
            {(['ast', 'text'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setPanel(id)}
                className={`rounded px-2 py-1 ${panel === id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {id === 'ast' ? 'AST from blocks' : 'Loaded text'}
              </button>
            ))}
            <span className={`ml-auto text-xs ${holes.length ? 'text-amber-300' : 'text-emerald-300'}`}>
              {holes.length ? `${holes.length} empty socket(s): not sendable` : unchanged ? 'equal to the loaded program' : 'changed, complete'}
            </span>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs leading-5 text-slate-300">
            {panel === 'ast' ? JSON.stringify(ast, null, 2) : (texts[`${CORPUS}${example}.canonical.sl`] ?? 'A new program has no text yet: the backend prints it from the AST.')}
          </pre>
        </div>
      </div>
    </div>
  )
}
