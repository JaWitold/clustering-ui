// AST (spec §6.1) <-> Blockly workspace state. Pure data on both sides: no Blockly import here.
import type { Action, Block, Const, Expr, If, Program, ProgramCall, Return } from './ast.ts'

export type BlockState = {
  type: string
  id?: string
  x?: number
  y?: number
  fields?: Record<string, unknown>
  inputs?: Record<string, { block?: BlockState }>
  next?: { block?: BlockState }
  extraState?: Record<string, unknown>
  icons?: { comment?: { text: string; pinned: boolean; height: number; width: number } }
}
export type WorkspaceState = { blocks?: { languageVersion?: number; blocks: BlockState[] } }

/** An empty socket: the AST cannot be sent to the backend until it is filled (spec §6, E0802). */
export type Hole = { blockId: string | undefined; blockType: string; input: string }

export const OVERRIDE_PREFIX = 'OVERRIDE_'
export const FUNCTION_PREFIX = 'sl_fn_'

const LOGIC = ['or', 'and']
const COMPARE = ['==', '!=', '<', '<=', '>', '>=']

const INT_MAX = 9223372036854775807n

/** Number literal in canonical form (spec §2.5, §5), or null when it is not a valid literal. */
export function normalizeNumber(text: string): string | null {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(text.trim())
  if (!match) return null
  const [, sign, int, fraction] = match
  if (fraction === undefined) {
    if (BigInt(int) > INT_MAX) return null
    return (int === '0' ? '' : sign) + int
  }
  if (int.length > 12) return null
  const trimmed = fraction.replace(/0+$/, '') || '0'
  return (int === '0' && trimmed === '0' ? '' : sign) + `${int}.${trimmed}`
}

export function negateNumber(value: string): string {
  if (value.startsWith('-')) return value.slice(1)
  return /^0(\.0)?$/.test(value) ? value : `-${value}`
}

// ---------------------------------------------------------------------------- AST -> state

const input = (block: BlockState) => ({ block })

function withComment(block: BlockState, comment: string | null): BlockState {
  return comment === null ? block : { ...block, icons: { comment: { text: comment, pinned: false, height: 80, width: 200 } } }
}

function exprState(expr: Expr): BlockState {
  switch (expr.type) {
    case 'binary': {
      const type = LOGIC.includes(expr.op) ? 'sl_logic' : COMPARE.includes(expr.op) ? 'sl_compare' : 'sl_arith'
      return { type, fields: { OP: expr.op }, inputs: { A: input(exprState(expr.left)), B: input(exprState(expr.right)) } }
    }
    case 'unary':
      return { type: expr.op === 'not' ? 'sl_not' : 'sl_negate', inputs: { A: input(exprState(expr.operand)) } }
    case 'literal':
      return expr.kind === 'bool'
        ? { type: 'sl_boolean', fields: { BOOL: String(expr.value) } }
        : { type: 'sl_number', fields: { NUM: expr.value } }
    case 'const_ref':
      return { type: 'sl_const_ref', fields: { NAME: expr.name } }
    case 'sys_call':
      return {
        type: FUNCTION_PREFIX + expr.name,
        inputs: Object.fromEntries(expr.args.map((arg, index) => [`ARG${index}`, input(exprState(arg))])),
      }
  }
}

function resultState(value: Action | ProgramCall): BlockState {
  if (value.type === 'action') return { type: 'sl_action', fields: { CUT: value.cut ?? '', HIKE: value.hike ?? '' } }
  return {
    type: 'sl_program_call',
    extraState: { overrides: value.overrides.map((override) => override.name) },
    fields: { PROGRAM: value.slug },
    inputs: Object.fromEntries(value.overrides.map((override) => [OVERRIDE_PREFIX + override.name, input(exprState(override.value))])),
  }
}

/** Links blocks into a statement chain; returns the first one. */
function chain(blocks: BlockState[]): BlockState | undefined {
  return blocks.reduceRight<BlockState | undefined>((next, block) => (next ? { ...block, next: { block: next } } : block), undefined)
}

function ifState(statement: If): BlockState {
  const inputs: Record<string, { block?: BlockState }> = {}
  statement.branches.forEach((branch, index) => {
    inputs[`IF${index}`] = input(exprState(branch.condition))
    inputs[`DO${index}`] = { block: blockChain(branch.block) }
  })
  if (statement.else) inputs.ELSE = { block: blockChain(statement.else) }
  const extraState: Record<string, unknown> = {}
  if (statement.branches.length > 1) extraState.elseIfCount = statement.branches.length - 1
  if (statement.else) extraState.hasElse = true
  return withComment({ type: 'sl_if', ...(Object.keys(extraState).length ? { extraState } : {}), inputs }, statement.comment)
}

function blockChain(block: Block): BlockState | undefined {
  const nested = block.result
    ? [withComment({ type: 'sl_return', inputs: { RESULT: input(resultState(block.result.value)) } }, block.result.comment)]
    : []
  return chain([...block.statements.map(ifState), ...nested])
}

export function astToState(program: Program): WorkspaceState {
  const consts = chain(
    program.constants.map((constant) =>
      withComment({ type: 'sl_const', fields: { NAME: constant.name }, inputs: { VALUE: input(exprState(constant.value)) } }, constant.comment),
    ),
  )
  const body = chain(program.statements.map(ifState))
  const root: BlockState = {
    type: 'sl_program',
    x: 24,
    y: 24,
    fields: { VERSION: `v${program.version}` },
    inputs: {
      ...(consts ? { CONSTS: input(consts) } : {}),
      ...(body ? { BODY: input(body) } : {}),
      // the final `return` is the fixed RESULT socket; its comment sits on the block plugged into it
      RESULT: input(withComment(resultState(program.result.value), program.result.comment)),
    },
  }
  return { blocks: { languageVersion: 0, blocks: [root] } }
}

// ---------------------------------------------------------------------------- state -> AST

export function stateToAst(state: WorkspaceState): { ast: Program | null; holes: Hole[] } {
  const holes: Hole[] = []
  const root = state.blocks?.blocks.find((block) => block.type === 'sl_program')
  if (!root) return { ast: null, holes }

  const child = (block: BlockState, name: string): BlockState | undefined => {
    const target = block.inputs?.[name]?.block
    if (!target) holes.push({ blockId: block.id, blockType: block.type, input: name })
    return target
  }
  const comment = (block: BlockState | undefined) => block?.icons?.comment?.text ?? null
  const field = (block: BlockState, name: string) => String(block.fields?.[name] ?? '')

  // A hole yields `null` in the tree; the caller must not send the AST while `holes` is not empty.
  const expr = (block: BlockState | undefined): Expr => {
    if (!block) return null as unknown as Expr
    switch (block.type) {
      case 'sl_logic':
      case 'sl_compare':
      case 'sl_arith':
        return { type: 'binary', op: field(block, 'OP'), left: expr(child(block, 'A')), right: expr(child(block, 'B')) }
      case 'sl_not':
        return { type: 'unary', op: 'not', operand: expr(child(block, 'A')) }
      case 'sl_negate': {
        const operand = expr(child(block, 'A'))
        // spec §3.2: a negation never holds a number literal, the minus is part of the literal
        if (operand?.type === 'literal' && operand.kind !== 'bool') return { ...operand, value: negateNumber(operand.value) }
        return { type: 'unary', op: 'neg', operand }
      }
      case 'sl_number': {
        const value = field(block, 'NUM')
        return { type: 'literal', kind: value.includes('.') ? 'decimal' : 'int', value }
      }
      case 'sl_boolean':
        return { type: 'literal', kind: 'bool', value: field(block, 'BOOL') === 'true' }
      case 'sl_const_ref':
        return { type: 'const_ref', name: field(block, 'NAME') }
      default: {
        const args = Object.keys(block.inputs ?? {}).filter((name) => name.startsWith('ARG')).sort()
        return { type: 'sys_call', name: block.type.slice(FUNCTION_PREFIX.length), args: args.map((name) => expr(child(block, name))) }
      }
    }
  }

  const result = (block: BlockState | undefined): Action | ProgramCall => {
    if (!block) return null as unknown as Action
    if (block.type === 'sl_action') return { type: 'action', cut: field(block, 'CUT') || null, hike: field(block, 'HIKE') || null }
    const overrides = Object.entries(block.inputs ?? {})
      .filter(([name, value]) => name.startsWith(OVERRIDE_PREFIX) && value.block)
      .map(([name, value]) => ({ type: 'override' as const, name: name.slice(OVERRIDE_PREFIX.length), value: expr(value.block) }))
    return { type: 'program_call', slug: field(block, 'PROGRAM'), overrides }
  }

  const statements = (owner: BlockState, name: string, required: boolean): Block => {
    const block: Block = { type: 'block', statements: [], result: null }
    let current = owner.inputs?.[name]?.block
    if (!current && required) holes.push({ blockId: owner.id, blockType: owner.type, input: name })
    for (; current; current = current.next?.block) {
      if (current.type === 'sl_return') {
        block.result = { type: 'return', value: result(child(current, 'RESULT')), comment: comment(current) }
      } else {
        block.statements.push(ifStatement(current))
      }
    }
    return block
  }

  const ifStatement = (block: BlockState): If => {
    const branchCount = 1 + Number(block.extraState?.elseIfCount ?? 0)
    return {
      type: 'if',
      branches: Array.from({ length: branchCount }, (_, index) => ({
        type: 'branch' as const,
        condition: expr(child(block, `IF${index}`)),
        block: statements(block, `DO${index}`, true),
      })),
      else: block.extraState?.hasElse ? statements(block, 'ELSE', true) : null,
      comment: comment(block),
    }
  }

  const constants: Const[] = []
  for (let current = root.inputs?.CONSTS?.block; current; current = current.next?.block) {
    if (!field(current, 'NAME')) holes.push({ blockId: current.id, blockType: current.type, input: 'NAME' })
    constants.push({ type: 'const', name: field(current, 'NAME'), value: expr(child(current, 'VALUE')), comment: comment(current) })
  }
  const final = child(root, 'RESULT')
  const programResult: Return = { type: 'return', value: result(final), comment: comment(final) }

  return {
    ast: {
      type: 'program',
      version: Number(field(root, 'VERSION').slice(1)),
      constants,
      statements: statements(root, 'BODY', false).statements,
      result: programResult,
    },
    holes,
  }
}
