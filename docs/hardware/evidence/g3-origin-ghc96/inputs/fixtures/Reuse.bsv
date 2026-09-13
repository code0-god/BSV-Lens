package Reuse;

interface Sample#(numeric type width);
   method Action put(Bit#(width) value);
   method Bit#(width) get;
endinterface

(* synthesize *)
module mkBiased#(parameter Bit#(8) bias)(Sample#(8));
   Reg#(Bit#(8)) state <- mkReg(0);
   method Action put(Bit#(8) value);
      state <= value + bias;
   endmethod
   method Bit#(8) get = state;
endmodule

// A generic source definition is inlined into two concrete RTL wrappers.
module mkWidth(Sample#(width));
   Reg#(Bit#(width)) state <- mkReg(0);
   method Action put(Bit#(width) value);
      state <= value + 1;
   endmethod
   method Bit#(width) get = state;
endmodule

(* synthesize *)
module mkNarrow(Sample#(8));
   let implementation <- mkWidth;
   return implementation;
endmodule

(* synthesize *)
module mkWide(Sample#(12));
   let implementation <- mkWidth;
   return implementation;
endmodule

interface Reuse;
   method Action put(Bit#(8) value);
   method Bit#(12) get;
endinterface

(* synthesize *)
module mkReuse(Reuse);
   Sample#(8) low <- mkBiased(3);
   Sample#(8) high <- mkBiased(9);
   Sample#(8) narrow <- mkNarrow;
   Sample#(12) wide <- mkWide;
   method Action put(Bit#(8) value);
      low.put(value);
      high.put(value);
      narrow.put(low.get);
      wide.put(zeroExtend(high.get));
   endmethod
   method Bit#(12) get = wide.get + zeroExtend(narrow.get);
endmodule
endpackage
