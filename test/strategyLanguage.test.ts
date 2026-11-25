import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as Blockly from 'blockly'
import { fixtureCatalog } from '../src/strategyLanguage/catalog.ts'
import { CONNECTION_CHECKER, defineBlocks, foldNegations, isValidName } from '../src/strategyLanguage/blocks.ts'
import { astToState, normalizeNumber, stateToAst, type WorkspaceState } from '../src/strategyLanguage/mapping.ts'

const corpus = new URL('../fixtures/data/strategy-language/corpus/valid/', import.meta.url)
const cases = readdirSync(corpus).filter((file) => file.endsWith('.ast.json'))

defineBlocks(fixtureCatalog)

function load(state: WorkspaceState): Blockly.Workspace {
  const workspace = new Blockly.Workspace({ plugins: { connectionChecker: CONNECTION_CHECKER } })
  Blockly.serialization.workspaces.load(state, workspace)
  return workspace
}

const save = (workspace: Blockly.Workspace) => Blockly.serialization.workspaces.save(workspace) as WorkspaceState
const program = (inputs: object) => ({ blocks: { blocks: [{ type: 'sl_program', inputs }] } }) as WorkspaceState
const stay = { block: { type: 'sl_action' } }
const condition = { block: { type: 'sl_boolean' } }

test('the corpus has its valid cases', () => {
  assert.equal(cases.length, 18)
})

for (const file of cases) {
  test(`AST -> blocks -> AST without differences: ${file}`, () => {
    const ast = JSON.parse(readFileSync(new URL(file, corpus), 'utf8'))
    const result = stateToAst(save(load(astToState(ast))))
    assert.deepEqual(result.holes, [])
    assert.deepEqual(result.ast, ast)
  })
}

test('a number in a negation block becomes a negative number', () => {
  const negated = (value: string) => ({ type: 'sl_negate', inputs: { A: { block: { type: 'sl_number', fields: { NUM: value } } } } })
  const workspace = load(
    program({
      CONSTS: { block: { type: 'sl_const', fields: { NAME: 'a' }, inputs: { VALUE: { block: { type: 'sl_negate', inputs: { A: { block: negated('5') } } } } } } },
      RESULT: stay,
    }),
  )
  assert.deepEqual(stateToAst(save(workspace)).ast?.constants[0].value, { type: 'literal', kind: 'int', value: '5' })

  foldNegations(workspace)
  assert.equal(workspace.getBlocksByType('sl_negate').length, 0)
  const number = workspace.getBlocksByType('sl_const')[0].getInputTargetBlock('VALUE')
  assert.equal(number?.type, 'sl_number')
  assert.equal(number?.getFieldValue('NUM'), '5')

  const single = load(program({ CONSTS: { block: { type: 'sl_const', fields: { NAME: 'a' }, inputs: { VALUE: { block: negated('0.5') } } } }, RESULT: stay }))
  foldNegations(single)
  assert.equal(single.getBlocksByType('sl_const')[0].getInputTargetBlock('VALUE')?.getFieldValue('NUM'), '-0.5')
})

test('`return` is refused in the top-level chain and accepted in a nested block', () => {
  const returns = { type: 'sl_return', inputs: { RESULT: stay } }
  const rule = (extra: object) => ({ type: 'sl_if', inputs: { IF0: condition, DO0: { block: returns } }, ...extra })

  assert.throws(() => load(program({ BODY: { block: returns }, RESULT: stay })))
  assert.throws(() => load(program({ BODY: { block: rule({ next: { block: returns } }) }, RESULT: stay })))
  assert.throws(() => load(program({ BODY: { block: rule({ next: { block: rule({ next: { block: returns } }) } }) }, RESULT: stay })))

  const nested = { type: 'sl_if', inputs: { IF0: condition, DO0: { block: rule({ next: { block: returns } }) } } }
  assert.deepEqual(stateToAst(save(load(program({ BODY: { block: nested }, RESULT: stay })))).holes, [])
})

test('sockets accept only their own kind', () => {
  const number = { block: { type: 'sl_number' } }
  assert.throws(() => load(program({ RESULT: number })), 'a number is not an action')
  assert.throws(() => load(program({ BODY: { block: { type: 'sl_if', inputs: { IF0: number } } }, RESULT: stay })), 'a number is not a condition')
  assert.throws(() => load(program({ BODY: { block: { type: 'sl_const', fields: { NAME: 'a' } } }, RESULT: stay })), 'a constant is not a rule')
  assert.throws(() => load(program({ CONSTS: { block: { type: 'sl_const', fields: { NAME: 'a' }, inputs: { VALUE: stay } } }, RESULT: stay })))
  const compare = (op: string) => ({ block: { type: 'sl_compare', fields: { OP: op }, inputs: { A: condition, B: condition } } })
  assert.throws(() => load(program({ BODY: { block: { type: 'sl_if', inputs: { IF0: compare('<'), DO0: { block: { type: 'sl_return', inputs: { RESULT: stay } } } } } }, RESULT: stay })))
  load(program({ BODY: { block: { type: 'sl_if', inputs: { IF0: compare('=='), DO0: { block: { type: 'sl_return', inputs: { RESULT: stay } } } } } }, RESULT: stay }))
})

test('empty sockets are reported instead of producing an AST to send', () => {
  const { holes } = stateToAst(save(load(program({ BODY: { block: { type: 'sl_if' } } }))))
  assert.deepEqual(holes.map((hole) => `${hole.blockType}.${hole.input}`), ['sl_program.RESULT', 'sl_if.IF0', 'sl_if.DO0'])
})

test('a program call shows a socket per constant of the called program and keeps unknown overrides', () => {
  const call = (fields: object, extra: object = {}) => load(program({ RESULT: { block: { type: 'sl_program_call', fields, ...extra } } })).getBlocksByType('sl_program_call')[0]
  const sockets = (block: Blockly.Block) => block.inputList.map((input) => input.name).filter((name) => name.startsWith('OVERRIDE_'))

  assert.deepEqual(sockets(call({ PROGRAM: 'night_pause' })), ['OVERRIDE_first_hour', 'OVERRIDE_last_hour', 'OVERRIDE_enabled'])
  const unknown = call({ PROGRAM: 'gone' }, { extraState: { overrides: ['limit'] }, inputs: { OVERRIDE_limit: { block: { type: 'sl_number' } } } })
  assert.equal(unknown.getFieldValue('PROGRAM'), 'gone')
  assert.deepEqual(sockets(unknown), ['OVERRIDE_limit'])
})

test('renaming a constant renames its references', () => {
  const workspace = load(
    program({
      CONSTS: { block: { type: 'sl_const', fields: { NAME: 'limit' }, inputs: { VALUE: { block: { type: 'sl_number' } } } } },
      BODY: { block: { type: 'sl_if', inputs: { IF0: { block: { type: 'sl_compare', inputs: { A: { block: { type: 'sl_const_ref', fields: { NAME: 'limit' } } } } } } } } },
      RESULT: stay,
    }),
  )
  workspace.getBlocksByType('sl_const')[0].setFieldValue('budget', 'NAME')
  assert.equal(workspace.getBlocksByType('sl_const_ref')[0].getFieldValue('NAME'), 'budget')
})

test('number literals follow the lexer rules', () => {
  const rows: [string, string | null][] = [
    ['0', '0'], ['-0', '0'], ['-0.0', '0.0'], ['1.50', '1.5'], ['2.00', '2.0'], ['-0.50', '-0.5'],
    ['9223372036854775807', '9223372036854775807'], ['9223372036854775808', null],
    ['999999999999.999999', '999999999999.999999'], ['1000000000000.0', null],
    ['007', null], ['1.', null], ['0.1234567', null], ['2h', null], ['', null],
  ]
  for (const [text, expected] of rows) assert.equal(normalizeNumber(text), expected, text)
})

test('constant names follow the identifier rules', () => {
  const rows: [string, boolean][] = [['limit', true], ['a'.repeat(64), true], ['a'.repeat(65), false], ['Limit', false], ['let', false], ['v2', false], ['2x', false], ['', false]]
  for (const [name, expected] of rows) assert.equal(isValidName(name), expected, name)
})
