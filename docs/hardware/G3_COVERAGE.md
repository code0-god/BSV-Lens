# G3 measured coverage

Machine ledger: [G3_COVERAGE.json](G3_COVERAGE.json).
Each G3-A row binds source/evidence/provider identities, its actual snapshot,
selection rule, population IDs/hash and outcome counts. The G3-B ledger binds
the separate instrumented artifacts, compiler/reducer/patch and provider.
Definition leaves, occurrence leaves, aliases and source records are not
interchangeable populations.

## G3-A stock correspondence

| Category | A | B | C | Meaning |
| --- | --- | --- | --- | --- |
| Lexical source records | 31/31 | 37/37 | 62/62 | Source range/revision, not origin. |
| Contextual method contracts | 6/6 | 2/2 | 10/14 | Four C inlined endpoints remain unmapped. |
| Contextual method connectivity | 6/6 | 2/2 | 10/14 | Actual ordered port/net/pin relations. |
| Occurrence leaf origins | 0/11 | 0/26 | 0/21 | Stock metadata has no origin lineage. |
| Definition alias origins | 0/31 | 0/49 | 0/88 | No inference from generated locations. |
| Contextual storage origin sets | 0/2 | 0/2 | 0/4 | Separate from source declaration support. |
| Existing semantic expression records | 0/11 | 0/20 | 0/21 | Not the historical outermost-expression census. |

## G3-B instrumented compiler and reader

Selection: every non-hierarchical definition cell in the three instrumented
JSON artifacts. The 53 fixed target tuples and their hash are in
`g3B.definitionPopulation` and `definitionPopulationHash`.

| Outcome | Definition objects |
| --- | ---: |
| At least one verified known contributor | 6 |
| Tagged transport with an unsupported compiler/reader boundary | 6 |
| No accepted or tagged leaf origin path | 41 |
| Complete origin sets | 0 |

The six accepted objects are storage and RHS leaves in `mkStage`, `mkNarrow`
and `mkWide`. The six partial objects are Control's two arithmetic leaves and
the two storage/arithmetic pairs in parameter-derived Biased definitions.
Counts of generated/removed origin claims are zero: missing roots are not
evidence of removal, and nearby reset/mux/control logic gets no guessed cause.

| Product occurrence population | Known contributor objects | Complete sets |
| --- | ---: | ---: |
| A: 11 leaves | 4 | 0 |
| B: 26 leaves | 0 | 0 |
| C: 21 leaves | 4 | 0 |

The eight occurrence objects are not eight definition objects. A's left/right
instantiate the same two definition leaves. C's narrow/wide retain concrete
8/12-bit contexts; no `implementation` module or owned subset is fabricated.
Six hierarchy-cell links in the captured sidecar are excluded from leaf
numerators and are not currently exposed as product leaf-origin claims.

All 168 actual instrumented definition aliases have fixed artifact/module/name
tuples and a population hash under `g3B.aliases`. Known alias contributors and
complete alias sets remain zero. Cell origin does not propagate to every
connected alias or pin.

## Historical baseline remains unchanged

- Storage origin sets: 0/8.
- Inventoried outermost expression sites: 0/22, not all AST subexpressions.
- Definition leaf causes: 0/53.
- Definition netname-alias causes: 0/168.

These refer to the preserved G1-BSV run. The new instrumented run does not rewrite
its history. Source links, successful queries, method contracts and connectivity
components never enter an origin numerator.

Known-contributor scope is narrower than complete original-cause coverage.
Full source origin for Control, parameter cloning, shared/merged/generated logic,
memory/FIFO and unsupported transformations remains partial or unsupported.
