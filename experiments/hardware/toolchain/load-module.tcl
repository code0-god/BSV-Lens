# Probe runner exits nonzero on missing elaboration metadata.
lassign $argv bdir top
Bluetcl::flags set -verilog -bdir $bdir
Bluetcl::module load $top
puts "Loaded $top"
