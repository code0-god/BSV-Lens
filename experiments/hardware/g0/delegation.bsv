package G0Delegation;
interface SourceIfc;
    method Bit#(8) value;
endinterface
module mkSource(SourceIfc);
    method Bit#(8) value = 1;
endmodule
module mkProxy#(SourceIfc upstream)(SourceIfc);
    method Bit#(8) value = 42;
endmodule
module mkTop(Empty);
    SourceIfc producer <- mkSource;
    SourceIfc proxy <- mkProxy(producer);
endmodule
endpackage
