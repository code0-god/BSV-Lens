# ADR 007: missing tools do not change evidence meaning

Status: proposed for G1 approval.

Decision: permit importing supported existing compiled artifacts without BSC
or a reader installed. New builds require explicit execution on the actual
extension host under Workspace Trust. Source-only analysis remains available
as `Source-derived preview - compiled wiring unavailable`.

Rejected: silently downloading/bundling large toolchains, automatically
executing Make/Tcl on file save, or displaying source-inferred wires under a
compiled badge when compilation fails.

Consequences: failed/cancelled builds preserve the last successful snapshot.
Capabilities separately state import, compile, correspondence and unsupported
semantics. Known black-box ports remain visible; unknown internals are not
guessed. Local/remote tool identities and output paths are inspectable.

G1's isolated tool experiment is a development dependency, not a product
installer. A local browser prototype does not establish VS Code host trust
or installed-extension acceptance; those are explicit G6 work.
