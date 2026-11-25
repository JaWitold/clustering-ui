// Blockly blocks of strategy language v1: one block per grammar production (spec §6).
import * as Blockly from 'blockly'
import type { Catalog } from './catalog.ts'
import { FUNCTION_PREFIX, OVERRIDE_PREFIX, negateNumber, normalizeNumber } from './mapping.ts'

export const CONNECTION_CHECKER = 'strategy_language'

const KEYWORDS = new Set([
  'version', 'const', 'if', 'then', 'elseif', 'else', 'end', 'return', 'stay', 'cut', 'hike', 'fn', 'and', 'or', 'not', 'true', 'false',
  'let', 'use', 'import', 'default', 'null', 'paid', 'do', 'while', 'for', 'function',
])

const VALUE = ['Number', 'Boolean']
const NESTED = ['sl_if', 'sl_return']
const HUE = { program: 260, statement: 210, action: 20, logic: 160, number: 230, constant: 330, function: 45 }
const FUNCTION_CATEGORIES: [string, string][] = [
  ['price', 'Price and corridor'],
  ['competitors', 'Competitors'],
  ['price_changes', 'Price changes'],
  ['margin', 'Margin'],
  ['time', 'Time'],
]

export function isValidName(name: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(name) && !KEYWORDS.has(name) && !/^v[0-9]+$/.test(name)
}

/** Dropdown that keeps a value missing from its options: an unknown program or constant is the backend's error to report. */
class LooseDropdown extends Blockly.FieldDropdown {
  protected override doClassValidation_(newValue?: string): string | null {
    return newValue ?? null
  }
}

function looseDropdown(options: (field: Blockly.FieldDropdown) => string[], empty: string): Blockly.FieldDropdown {
  return new LooseDropdown(function (this: Blockly.FieldDropdown) {
    const values = options(this)
    const current = this.getValue()
    if (current && !values.includes(current)) values.push(current)
    return values.length ? values.map((value) => [value, value]) : [[empty, '']]
  })
}

/** A `return` may end a nested block only: at the top level it would be code after `return` (spec §6). */
class StrategyConnectionChecker extends Blockly.ConnectionChecker {
  override doTypeChecks(a: Blockly.Connection, b: Blockly.Connection): boolean {
    if (!super.doTypeChecks(a, b)) return false
    const [parent, child] = a.type === Blockly.ConnectionType.PREVIOUS_STATEMENT ? [b, a] : [a, b]
    if (child.type !== Blockly.ConnectionType.PREVIOUS_STATEMENT) return true
    const owner = parent.getSourceBlock()
    const topLevel = owner.type === 'sl_program' || (parent === owner.nextConnection && owner.getSurroundParent()?.type === 'sl_program')
    if (!topLevel) return true
    let last = child.getSourceBlock()
    for (let next = last.getNextBlock(); next; next = next.getNextBlock()) last = next
    return last.type !== 'sl_return'
  }
}

/** Number block inside a negation block becomes a negative number at once (spec §3.2, §6). */
export function foldNegations(workspace: Blockly.Workspace): void {
  for (let folded = true; folded; ) {
    folded = false
    for (const negation of workspace.getBlocksByType('sl_negate')) {
      const number = negation.getInputTargetBlock('A')
      if (number?.type !== 'sl_number' || !number.outputConnection) continue
      const target = negation.outputConnection?.targetConnection
      number.setFieldValue(negateNumber(number.getFieldValue('NUM')), 'NUM')
      number.unplug()
      negation.unplug()
      target?.connect(number.outputConnection)
      negation.dispose()
      folded = true
    }
  }
}

function setStatementChecks(block: Blockly.Block): void {
  for (const input of block.inputList) {
    if (input.name === 'ELSE' || input.name.startsWith('DO')) input.setCheck(NESTED)
  }
}

let defined = false

export function defineBlocks(catalog: Catalog): void {
  if (defined) return
  defined = true

  Blockly.registry.register(Blockly.registry.Type.CONNECTION_CHECKER, CONNECTION_CHECKER, StrategyConnectionChecker)

  // the built-in `if` mutator adds these labels; the blocks read like the text of the language
  Blockly.Msg.CONTROLS_IF_MSG_THEN = 'then'
  Blockly.Msg.CONTROLS_IF_MSG_ELSEIF = 'elseif'
  Blockly.Msg.CONTROLS_IF_MSG_ELSE = 'else'

  Blockly.Extensions.register('sl_if_statement_checks', function (this: Blockly.Block) {
    const block = this as Blockly.Block & { updateShape_: () => void }
    const updateShape = block.updateShape_
    block.updateShape_ = function () {
      updateShape.call(this)
      setStatementChecks(this)
    }
    setStatementChecks(block)
  })

  const strategyOptions = (direction: string) => [
    ['no change', ''],
    ...catalog.strategies.filter((strategy) => strategy.direction === direction).map((strategy) => [strategy.name, strategy.name]),
  ]
  const binary = (type: string, ops: string[], inputCheck: string | string[], output: string, colour: number) => ({
    type,
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A', check: inputCheck },
      { type: 'field_dropdown', name: 'OP', options: ops.map((op) => [op, op]) },
      { type: 'input_value', name: 'B', check: inputCheck },
    ],
    inputsInline: true,
    output,
    colour,
  })

  Blockly.common.defineBlocksWithJsonArray([
    {
      type: 'sl_program',
      message0: 'version %1',
      args0: [{ type: 'field_label_serializable', name: 'VERSION', text: 'v1' }],
      message1: 'constants %1',
      args1: [{ type: 'input_statement', name: 'CONSTS', check: 'sl_const' }],
      message2: 'rules %1',
      args2: [{ type: 'input_statement', name: 'BODY', check: 'sl_if' }],
      message3: 'return %1',
      args3: [{ type: 'input_value', name: 'RESULT', check: 'Action' }],
      colour: HUE.program,
      tooltip: 'The program. The final `return` is this fixed socket: it cannot be left out or moved.',
    },
    {
      type: 'sl_if',
      message0: 'if %1',
      args0: [{ type: 'input_value', name: 'IF0', check: 'Boolean' }],
      message1: 'then %1',
      args1: [{ type: 'input_statement', name: 'DO0' }],
      previousStatement: 'sl_if',
      nextStatement: NESTED,
      colour: HUE.statement,
      mutator: 'controls_if_mutator',
      extensions: ['sl_if_statement_checks'],
    },
    {
      type: 'sl_return',
      message0: 'return %1',
      args0: [{ type: 'input_value', name: 'RESULT', check: 'Action' }],
      previousStatement: 'sl_return',
      colour: HUE.statement,
      tooltip: 'Ends the program. Only inside `then` / `else`: at the top level use the socket of the program block.',
    },
    {
      type: 'sl_action',
      message0: 'cut %1 hike %2',
      args0: [
        { type: 'field_dropdown', name: 'CUT', options: strategyOptions('cut') },
        { type: 'field_dropdown', name: 'HIKE', options: strategyOptions('hike') },
      ],
      output: 'Action',
      colour: HUE.action,
      tooltip: 'Strategy per direction. Both set to "no change" is `stay`.',
    },
    binary('sl_logic', ['and', 'or'], 'Boolean', 'Boolean', HUE.logic),
    binary('sl_compare', ['==', '!=', '<', '<=', '>', '>='], VALUE as unknown as string, 'Boolean', HUE.logic),
    binary('sl_arith', ['+', '-', '*', '/'], 'Number', 'Number', HUE.number),
    { type: 'sl_not', message0: 'not %1', args0: [{ type: 'input_value', name: 'A', check: 'Boolean' }], output: 'Boolean', colour: HUE.logic },
    { type: 'sl_negate', message0: '- %1', args0: [{ type: 'input_value', name: 'A', check: 'Number' }], output: 'Number', colour: HUE.number },
    {
      type: 'sl_boolean',
      message0: '%1',
      args0: [{ type: 'field_dropdown', name: 'BOOL', options: [['true', 'true'], ['false', 'false']] }],
      output: 'Boolean',
      colour: HUE.logic,
    },
    ...catalog.systemFunctions.map((fn) => ({
      type: FUNCTION_PREFIX + fn.name,
      message0: `${fn.name}()`,
      output: fn.returnType === 'bool' ? 'Boolean' : 'Number',
      colour: HUE.function,
      tooltip: `${fn.description} (${fn.returnType})`,
    })),
  ])

  Blockly.Blocks.sl_number = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(new Blockly.FieldTextInput('0', (text: string) => normalizeNumber(text)), 'NUM')
      this.setOutput(true, 'Number')
      this.setColour(HUE.number)
    },
  }

  // ordering comparisons take numbers only; `==` and `!=` also take two bools (spec §9.3)
  const compareInit = Blockly.Blocks.sl_compare.init
  Blockly.Blocks.sl_compare.init = function (this: Blockly.Block) {
    compareInit.call(this)
    const setChecks = (op: string) => {
      const check = op === '==' || op === '!=' ? VALUE : 'Number'
      this.getInput('A')?.setCheck(check)
      this.getInput('B')?.setCheck(check)
    }
    this.getField('OP')?.setValidator((op: string) => {
      setChecks(op)
      return op
    })
    setChecks('==')
  }

  Blockly.Blocks.sl_const = {
    init(this: Blockly.Block) {
      const name = new Blockly.FieldTextInput('', function (this: Blockly.FieldTextInput, newName: string) {
        if (!isValidName(newName)) return null
        const block = this.getSourceBlock()
        const oldName = this.getValue()
        // renaming a constant renames every reference to it in this program (spec §6)
        if (block && oldName && oldName !== newName) {
          for (const reference of block.workspace.getBlocksByType('sl_const_ref')) {
            if (reference.getFieldValue('NAME') === oldName) reference.setFieldValue(newName, 'NAME')
          }
        }
        return newName
      })
      this.appendValueInput('VALUE').setCheck(VALUE).appendField('const').appendField(name, 'NAME').appendField('=')
      this.setPreviousStatement(true, 'sl_const')
      this.setNextStatement(true, 'sl_const')
      this.setColour(HUE.constant)
    },
  }

  Blockly.Blocks.sl_const_ref = {
    init(this: Blockly.Block) {
      const names = (field: Blockly.FieldDropdown) => {
        const workspace = field.getSourceBlock()?.workspace as (Blockly.Workspace & { targetWorkspace?: Blockly.Workspace }) | undefined
        const declared = (workspace?.targetWorkspace ?? workspace)?.getBlocksByType('sl_const') ?? []
        return declared.map((block) => block.getFieldValue('NAME') as string).filter(Boolean)
      }
      this.appendDummyInput().appendField(looseDropdown(names, 'no constants'), 'NAME')
      // shortcut: accepts both value types; the real type of a constant is checked by the backend (E0301/E0302)
      this.setOutput(true, VALUE)
      this.setColour(HUE.constant)
    },
  }

  Blockly.Blocks.sl_program_call = {
    init(this: Blockly.Block & ProgramCallBlock) {
      this.overrides_ = []
      const program = looseDropdown(() => catalog.programs.map((callee) => callee.slug), 'no programs')
      program.setValidator((slug: string) => {
        this.updateShape_(slug)
        return slug
      })
      this.appendDummyInput().appendField('fn::').appendField(program, 'PROGRAM')
      this.setOutput(true, 'Action')
      this.setColour(HUE.action)
      this.setTooltip('Runs another program of the same language version. A filled socket overrides that constant of the called program; an empty one keeps its value.')
      this.updateShape_(program.getValue() ?? '')
    },
    saveExtraState(this: Blockly.Block) {
      const overrides = this.inputList
        .filter((input) => input.name.startsWith(OVERRIDE_PREFIX) && input.connection?.targetBlock())
        .map((input) => input.name.slice(OVERRIDE_PREFIX.length))
      return overrides.length ? { overrides } : null
    },
    loadExtraState(this: Blockly.Block & ProgramCallBlock, state: { overrides?: string[] }) {
      this.overrides_ = state.overrides ?? []
      this.updateShape_(this.getFieldValue('PROGRAM') ?? '')
    },
    // One socket per constant of the called program, plus the overrides of the loaded AST in their order.
    updateShape_(this: Blockly.Block & ProgramCallBlock, slug: string) {
      const callee = catalog.programs.find((candidate) => candidate.slug === slug)
      const connected = this.inputList
        .filter((input) => input.name.startsWith(OVERRIDE_PREFIX) && input.connection?.targetBlock())
        .map((input) => input.name.slice(OVERRIDE_PREFIX.length))
      const names = [...new Set([...this.overrides_, ...connected, ...(callee?.constants.map((constant) => constant.name) ?? [])])]
      for (const input of [...this.inputList]) {
        if (input.name.startsWith(OVERRIDE_PREFIX) && !names.includes(input.name.slice(OVERRIDE_PREFIX.length))) this.removeInput(input.name)
      }
      for (const name of names) {
        const type = callee?.constants.find((constant) => constant.name === name)?.type
        const check = type === undefined ? VALUE : type === 'bool' ? 'Boolean' : 'Number'
        const input = this.getInput(OVERRIDE_PREFIX + name) ?? this.appendValueInput(OVERRIDE_PREFIX + name).appendField(`${name} =`)
        input.setCheck(check)
        this.moveInputBefore(OVERRIDE_PREFIX + name, null)
      }
    },
  }
}

type ProgramCallBlock = { overrides_: string[]; updateShape_: (slug: string) => void }

export function toolbox(catalog: Catalog) {
  const blocks = (...types: string[]) => types.map((type) => ({ kind: 'block', type }))
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: 'Rules', colour: String(HUE.statement), contents: blocks('sl_if', 'sl_return') },
      { kind: 'category', name: 'Result', colour: String(HUE.action), contents: blocks('sl_action', 'sl_program_call') },
      { kind: 'category', name: 'Logic', colour: String(HUE.logic), contents: blocks('sl_compare', 'sl_logic', 'sl_not', 'sl_boolean') },
      { kind: 'category', name: 'Numbers', colour: String(HUE.number), contents: blocks('sl_number', 'sl_arith', 'sl_negate') },
      {
        kind: 'category',
        name: 'Constants',
        colour: String(HUE.constant),
        contents: [{ kind: 'block', type: 'sl_const', fields: { NAME: 'limit' }, inputs: { VALUE: { block: { type: 'sl_number' } } } }, ...blocks('sl_const_ref')],
      },
      ...FUNCTION_CATEGORIES.map(([category, name]) => ({
        kind: 'category',
        name,
        colour: String(HUE.function),
        contents: blocks(...catalog.systemFunctions.filter((fn) => fn.category === category).map((fn) => FUNCTION_PREFIX + fn.name)),
      })),
    ],
  }
}
