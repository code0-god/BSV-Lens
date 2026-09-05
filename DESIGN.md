# BSV Lens Design System

## 1. Atmosphere and identity

BSV Lens is an engineering instrument inside VS Code. Visual character stays precise, compact,
and diagram-first: quiet chrome around strongly differentiated graph semantics. Existing VS
Code-native appearance remains authoritative; v0.4.0 changes semantic hierarchy without creating
a separate branded visual world.

Signature moment: changing Level, Mode, or focus immediately reshapes one stable canvas while focus root remains visually anchored.

Product direction: BSV Lens primarily performs **BSV architecture and code analysis**. Its
primary projections are instantiated hardware architecture, typed interface/method flow, state
and behavior relationships, rule/method scheduling, and source evidence. Source/package maps
remain secondary projections, not the product architecture center.

The v0.4.0 semantic direction is:

```text
Definition -> Instance -> Endpoint -> Protocol Channel -> Semantic Flow -> Presentation
```

v0.4.0 implements this source-derived semantic pipeline. It does not present source analysis as
compiler-elaborated RTL.

## 2. Color

All live UI colors use VS Code theme variables. Fixed colors are allowed only inside exported standalone SVG so exports remain readable outside VS Code.

- Canvas: `--vscode-editor-background`
- Raised surfaces: `--vscode-sideBar-background`, `--vscode-editorWidget-background`
- Borders: `--vscode-panel-border`, `--vscode-contrastBorder`
- Text: `--vscode-foreground`, `--vscode-descriptionForeground`
- Focus: `--vscode-focusBorder`
- Selection: `--vscode-list-activeSelectionBackground`, `--vscode-list-activeSelectionForeground`
- Error and warning: matching VS Code editor and notification variables
- Graph kinds and relation kinds: VS Code symbol/chart variables, never color alone

High-contrast themes receive explicit borders and retain dash patterns, markers, labels, and badges.

## 3. Typography

- UI stack: `--vscode-font-family`
- Source, signatures, IDs, and evidence: `--vscode-editor-font-family`
- Caption: 9px, uppercase only for short semantic badges
- Small: 10px
- Body: 12px
- Control: 11px, medium weight
- Node title: 13px, bold
- Inspector title: 16px, bold

Labels stay sentence case except origin badges and compact SVG node-kind labels.

## 4. Spacing and layout

Spacing tokens:

- `--space-1`: 4px
- `--space-2`: 6px
- `--space-3`: 8px
- `--space-4`: 12px
- `--space-5`: 16px
- `--space-6`: 24px

Radius tokens:

- `--radius-control`: 4px
- `--radius-panel`: 7px
- `--radius-group`: 10px
- `--radius-pill`: 999px

Shell uses StyleGallery `panel-layout` pattern for predictable primary canvas and utility inspector: <https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/panel-layout.md>. Document body never owns graph scrolling. Canvas owns pan/zoom; inspector owns vertical detail scrolling. Toolbar and filter controls wrap by container width without overlapping.

Desktop keeps inspector beside canvas. Compact widths place inspector below canvas and allow empty inspector to consume no unnecessary height. Toolbar height is content-driven, never fixed.

## 5. Components and states

### Toolbar control group

Labeled fieldset-like group for Source, Level, Mode, and Scope. Native `select` serves Source; Level, Mode, and Scope use segmented buttons with `aria-pressed`. States: default, hover, pressed, focus-visible, disabled.

### Focus trail

Back button, breadcrumb buttons, and concise focus status. Breadcrumb order is source scope then focus stack. States: root, focused, unavailable focus.

### Graph node

SVG group with body, semantic accent, title, summary, optional member buckets, real port circles, and focus ring. States: default, hover, selected, connected, trace, dimmed, editor reveal, focus-visible.

System cards show source-derived instance name as primary title and target module definition as
secondary label. Synthetic roots and unresolved targets remain explicit. Module context cards keep
one stable interface and non-zero member-count summary; they never embed raw Method Port rows or
change size when a bucket toggles. Behavior cards show contextual rules, methods, relevant
endpoints, and state.

### Member bucket

SVG disclosure row with chevron path, relationship token, label, total/visible count, and expanded
members. Protocol Channels and Child Instances are primary expanded groups. State, Rules, Methods,
Local Functions, and Types stay available without flooding System view. Buckets with zero members
are omitted. Bucket remains sole disclosure owner: expanded members live inside one measured panel
and never reappear inside context card. Native interaction follows beui.dev `bouncy-accordion`:
button semantics, `aria-expanded`, controlled content identity, inert hidden content, and
reduced-motion fallback. Source: <https://beui.dev/r/bouncy-accordion/raw>.

### Method port

One logical BSV interface method represented by a Method card and Inspector metadata with category, parameters, return type, safe width status, and direction. It is always called “Method Port”; it never implies an RTL pin.

### Relation edge

Actual SVG path plus marker. Relation kind is encoded by label, marker/direction, stroke pattern, and color. Module Structure uses one collision-free module-to-group bus; group-to-member containment is encoded by the measured member panel rather than redundant crossing paths. Hierarchy markers use fixed diagram-space geometry so selection stroke changes never resize them. Potential scheduling dependencies are dashed. Bidirectional relations show markers at both ends.

### Multiple roots and external boundaries

System Structure uses one hierarchy region and one independently owned trunk per architecture
root. Root headers expose aggregate instance, channel, unresolved, and boundary counts without
expanding dense method lists. Source/package dependencies remain secondary. Root selection,
focus, and Back preserve semantic context rather than treating layout connectivity as scope.

Unbound public interfaces are external boundaries, not errors. System Data Flow separates
external inputs from outputs, labels direction, and retains source evidence in Inspector.
Structure uses summaries rather than additional external hardware cards. Boundary and inferred
relations remain readable without color. Node cards sit above buses and labels.

Source reveal feedback distinguishes hidden, other-view, ambiguous, and absent presentations.
Ambiguous definition occurrences require explicit selection; representative source evidence
never silently becomes the selected declaration.

### Origin badge and scheduling legend

Scheduling precedence cycles use one dashed warning-token region behind their member nodes while every original relation keeps its own kind, marker, and evidence. The region label reports member count and never replaces relation semantics.

Badges: `SOURCE-DERIVED`, `HEURISTIC`, `BSC AUTHORITATIVE`, `MIXED`. Legend is always visible in Scheduling mode and names conflict, conflict-free, sequential-before, mutually-exclusive, urgency, preemption, execution order, cycle SCC, and potential dependency.

### Inspector

Header, source location, primary actions, then semantic sections. Behavior inspection includes
Summary, Guard, Inputs, Outputs, State reads, State writes, Invocations, Protocol membership,
Upstream, Downstream, and Source evidence. Relation counts and expandable details follow.
Evidence uses monospace text. Duplicate relations are grouped by deduplication key.

### Feedback

Busy bar uses `aria-busy`; empty state explains next action; toast uses polite live announcements. Error text remains concise and points to Output Channel when evidence is longer.

Restricted Mode uses one persistent status notice between toolbar and filters. It keeps source
analysis controls available while naming disabled external capabilities. The notice uses VS
Code warning foreground/background variables, a visible border, and `role="status"`; it never
blocks or dims the source-derived graph.

## 6. Interaction and motion

Interaction stays immediate and restrained.

- Segmented selection changes use color/border state, not animated sliding geometry.
- Group chevrons rotate over `--motion-fast` (120ms).
- Inspector details reveal over `--motion-standard` (180ms).
- Focus changes perform one fit transition only when graph scope changes.
- Member disclosure relayout preserves the focused module screen anchor and current zoom.
- Pan and zoom update directly under pointer.
- Search uses 150ms debounce.
- Editor reveal pulse lasts one bounded cycle.

`prefers-reduced-motion: reduce` removes transforms and nonessential transitions. Keyboard and pointer behavior remain equivalent.

## 7. Responsive behavior

- Wide: one toolbar row when space permits; canvas and 320px inspector.
- Medium: toolbar wraps by semantic groups; inspector narrows to 280px.
- Compact: search and export actions wrap; inspector moves below canvas; controls remain at least 28px high.
- Very narrow: each semantic control group may occupy one row, but Level/Mode/Scope choices never overlap or horizontally scroll the page.

Graph layout responds to actual canvas bounds, not viewport assumptions. Module member panels score deterministic grid candidates against current canvas dimensions, include aggregate subtrees in their measured envelopes, and reserve a collision-free hierarchy channel. Long labels truncate visually but retain full tooltip and accessible name.

## 8. Accessibility constraints and accepted debt

Required:

- Every control has visible label, tooltip where useful, and focus-visible styling.
- SVG root exposes interactive descendants rather than hiding them behind image semantics.
- Nodes expose selection, drillability, and relation count.
- All state differences survive monochrome/high-contrast rendering.
- Port and scheduling meaning never relies on arrows or color alone.
- Touch targets remain usable at compact widths.
- Reduced motion is complete.

Accepted debt for v0.4.0:

- Layout uses deterministic source-derived dimensions rather than text measurement.
- Graph node keyboard traversal may follow rendered order instead of geometric nearest-neighbor navigation.
- Standalone SVG export uses one fixed accessible light palette, not host-theme fidelity.
