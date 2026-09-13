# Isolated G1 metadata experiment; not an existing BSC JSON exporter.
proc js {s} {
    return "\"[string map [list \\ \\\\ \" \\\" \n \\n \r \\r \t \\t] $s]\""
}
proc ja {values} { return "\[[join $values ,]\]" }
proc strings {values} { return [ja [lmap v $values {js $v}]] }
proc jo {pairs} {
    set fields {}
    foreach {key value} $pairs { lappend fields "[js $key]:$value" }
    return "\{[join $fields ,]\}"
}
proc tags {values} {
    set out [dict create]
    foreach item $values { dict set out [lindex $item 0] [lindex $item 1] }
    return $out
}
proc optional {d key} {
    if {[dict exists $d $key]} { return [dict get $d $key] }
    return ""
}
set records {}
proc query {args} {
    global records
    set result [uplevel #0 $args]
    lappend records [jo [list command [strings $args] result [js $result]]]
    return $result
}
proc tree {parent} {
    global nodes
    foreach child [query Bluetcl::browseinst list $parent] {
        set key [lindex $child 0]
        set detail [query Bluetcl::browseinst detail $key]
        set fields [list key $key parent $parent]
        foreach {k v} $detail { lappend fields $k [js $v] }
        lappend nodes [jo $fields]
        tree $key
    }
}
if {$argc != 4} { error "usage: metadata.tcl bdir package top output.json" }
lassign $argv bdir package top output
Bluetcl::flags set -verilog -bdir $bdir
query Bluetcl::module load $top
query Bluetcl::bpackage load $package
query Bluetcl::bpackage depend
query Bluetcl::depend file "experiments/hardware/fixtures/$package.bsv"
query Bluetcl::bpackage vsignals
set nodes {}
tree 0
set modules {}
foreach module [query Bluetcl::module list] {
    set module [lindex $module 0]
    set position [query Bluetcl::bpackage position ${package}::$module]
    set portinfo [tags [query Bluetcl::module ports $module]]
    set methods {}
    foreach method [dict get $portinfo interface] {
        if {[lindex $method 0] ne "method"} { error "unsupported fixture interface: $method" }
        lassign $method kind name rtlName
        set attrs [tags [lrange $method 3 end]]
        set args {}
        foreach arg [dict get $attrs args] {
            set a [tags $arg]
            lappend args [jo [list name [js [optional $a name]] port [js [dict get $a port]] size [dict get $a size]]]
        }
        set detail [query Bluetcl::rule full $module $rtlName]
        lappend methods [jo [list name [js $name] rtlName [js $rtlName] args [ja $args] enable [js [optional $attrs enable]] ready [js [optional $attrs ready]] result [js [optional $attrs result]] clock [js [optional $attrs clock]] reset [js [optional $attrs reset]] rawRule [js $detail]]]
    }
    set instances {}
    foreach instance [query Bluetcl::submodule full $module] {
        lassign $instance name definition
        set attrs [tags [lrange $instance 2 end]]
        set mports [lmap pair [dict get $attrs mports] {strings $pair}]
        lappend instances [jo [list name [js $name] definition [js $definition] position [strings [optional $attrs position]] mports [ja $mports]]]
    }
    set rules {}
    foreach rule [query Bluetcl::module rules $module] {
        set detail [query Bluetcl::rule full $module $rule]
        set attrs [tags [lrange $detail 1 end]]
        lappend rules [jo [list name [js $rule] position [strings [optional $attrs position]] predicate [js [optional $attrs predicate]] methodUses [js [optional $attrs methods]]]]
    }
    foreach command {ports porttypes} { query Bluetcl::submodule $command $module }
    foreach command {porttypes methods methodconditions} { query Bluetcl::module $command $module }
    foreach command {urgency execution methodinfo pathinfo warnings errors} { query Bluetcl::schedule $command $module }
    lappend modules [jo [list name [js $module] definitionPosition [strings $position] methods [ja $methods] instances [ja $instances] rules [ja $rules] moduleArgs [js [dict get $portinfo args]]]]
}
set f [open $output w]
puts $f [jo [list schema [js "g1-bluetcl-metadata-experiment-v1"] top [js $top] records [ja $records] modules [ja $modules] hierarchy [ja $nodes]]]
close $f
puts "Exported [llength $modules] module records and [llength $nodes] source hierarchy nodes to $output"
