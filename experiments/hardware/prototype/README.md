# BSV-native G1-BSV prototype

An isolated CommonJS/vanilla SVG experiment. It does not replace or package the
production extension. No dependency installation, compiler execution, or file
write is exposed by the browser server.

From the repository root:

```sh
node experiments/hardware/prototype/build.js
node experiments/hardware/prototype/server.js
```

Open **http://127.0.0.1:4178** (the exact loopback host is required). Select a
compiled build, then **Import build**. The default is BSV architecture, backed
by the existing Source/Semantic adapter. A body click opens BSV child instances,
storage and typed contacts. **Open RTL Implementation** is explicit and uses
the same immutable Hardware IR. `/?mode=rtl` is the explicit legacy RTL entry.
`PORT=0` selects an ephemeral port;
`PORT=4179` selects another fixed port. The server announces its exact URL.
Stop it with Ctrl-C.

The real artifacts must already exist under
`docs/hardware/evidence/toolchain/{A,B,C}/`, with the toolchain manifest and
installation inventories. If absent or hash-mismatched, the initial page stays
in the clearly labeled unavailable-wiring state. This server does not build
artifacts or repair evidence.

```sh
node --test experiments/hardware/prototype/*.test.js
```

Browser verification uses the existing `@playwright/test` package and the
installed Google Chrome channel. It downloads nothing. Screenshots, a machine
receipt, navigation red-seam evidence, build hashes, and execution logs live in
`.build/hardware/bsv-ui/`; retained RTL regressions write its `rtl-regression/`
subdirectory, not the historical prototype evidence. Tests subscribe to exact application events before
pointer/keyboard input; they never invoke the navigation controller.

## Controls

- Click an expandable block body once: enter inside the same shell.
- Info or Space: inspect without entry. Enter: primary action.
- Port, bus, bit, leaf: inspect; no parent entry. Ambiguous wire hits offer a chooser.
- Back/Forward: exact previous/next distinct BSV/RTL scene. Up: the active tree's actual parent.
- Breadcrumb: a new, reversible navigation that clears stale inspection.
- Wheel: geometry only. Drag: pan without click-through entry. Fit: full visible bounds.
- BSV selections expose original statements, explicit predicates, body paths,
  compiler confirmation and mapping gaps. Rules and methods are selected
  behavior overlays, never physical blocks. **Expand RTL signals** discloses
  compiler-supplied ports only. Inlined BSV occurrences retain their own IDs;
  RTL opens the verified containing wrapper honestly, with no guessed cells.
- Generated RTL actions open the verified hashed source slice. Enclosing RTL
  context is labeled separately. BSV actions require compiler-backed instance
  declarations or port-contract module context; module context is not an exact
  method source range. No exact column range is invented.

See `docs/hardware/UX_DESIGN.md` for measured support and the explicit G2-G7 debt.
The source drawer is **not** VS Code source reveal; production host integration
belongs to G6. Dense/narrow fits are honest overviews, not readable-detail claims.
