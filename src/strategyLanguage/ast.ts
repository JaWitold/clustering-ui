// Strategy language v1 AST as JSON (graph-v2 docs/price-engine/strategy-language/spec-v1.md §6.1).

export type Expr =
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'unary'; op: 'not' | 'neg'; operand: Expr }
  | { type: 'literal'; kind: 'int' | 'decimal'; value: string }
  | { type: 'literal'; kind: 'bool'; value: boolean }
  | { type: 'const_ref'; name: string }
  | { type: 'sys_call'; name: string; args: Expr[] }

export type Action = { type: 'action'; cut: string | null; hike: string | null }
export type Override = { type: 'override'; name: string; value: Expr }
export type ProgramCall = { type: 'program_call'; slug: string; overrides: Override[] }
export type Return = { type: 'return'; value: Action | ProgramCall; comment: string | null }
export type Block = { type: 'block'; statements: If[]; result: Return | null }
export type Branch = { type: 'branch'; condition: Expr; block: Block }
export type If = { type: 'if'; branches: Branch[]; else: Block | null; comment: string | null }
export type Const = { type: 'const'; name: string; value: Expr; comment: string | null }
export type Program = { type: 'program'; version: number; constants: Const[]; statements: If[]; result: Return }
