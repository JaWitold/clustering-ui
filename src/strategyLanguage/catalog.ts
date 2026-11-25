// Editor catalogue from fixture files; the real editor reads the same shapes from the API (graph-v2 plan, task 26).
import systemFunctions from '../../fixtures/data/strategy-language/system-functions.json' with { type: 'json' }
import strategies from '../../fixtures/data/strategy-language/strategies.json' with { type: 'json' }
import programs from '../../fixtures/data/strategy-language/programs.json' with { type: 'json' }

export type SystemFunction = { number: number; name: string; returnType: string; category: string; description: string }
export type Strategy = { direction: string; number: number; name: string; worksWithoutFreeChanges: boolean }
export type ProgramConstant = { name: string; type: string; value: string | boolean }
export type CallableProgram = { slug: string; name: string; languageVersion: number; constants: ProgramConstant[] }
export type Catalog = { systemFunctions: SystemFunction[]; strategies: Strategy[]; programs: CallableProgram[] }

export const fixtureCatalog: Catalog = { systemFunctions, strategies, programs }
