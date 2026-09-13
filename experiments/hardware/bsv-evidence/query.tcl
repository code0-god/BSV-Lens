# Supplement the unchanged, executed G1 metadata sidecar with documented queries.
# argv is the same four arguments as toolchain/metadata.tcl.
source experiments/hardware/toolchain/metadata.tcl
set records {}
query Bluetcl::version
foreach kind {all module type func} { query Bluetcl::defs $kind $package }
query Bluetcl::bpackage types $package
foreach module [Bluetcl::module list] {
    set module [lindex $module 0]
    set ifc [query Bluetcl::module ifc $module]
    query Bluetcl::type full $ifc
    query Bluetcl::module flags $module
    query Bluetcl::module submods $module
    foreach method [Bluetcl::module methods $module] {
        query Bluetcl::bpackage position ${package}::[lindex $method 0]
    }
}
if {$package eq "Reuse"} {
    query Bluetcl::bpackage position Reuse::mkWidth
    query Bluetcl::type full {Reuse::Sample#(12)}
}
set f [open [file join [file dirname $output] supplemental.json] w]
puts $f [jo [list schema [js "g1-bsv-public-query-supplement-v1"] records [ja $records]]]
close $f
