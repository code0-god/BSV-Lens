package Connected;

interface Stage;
   method Action put(Bit#(8) value);
   method Bit#(8) get;
endinterface

// Test design explicitly has separately synthesized child blocks.
(* synthesize *)
module mkStage(Stage);
   Reg#(Bit#(8)) state <- mkReg(0);
   method Action put(Bit#(8) value);
      state <= value + 1;
   endmethod
   method Bit#(8) get = state;
endmodule

(* synthesize *)
module mkConnected(Stage);
   Stage left <- mkStage;
   Stage right <- mkStage;
   method Action put(Bit#(8) value);
      left.put(value);
      right.put(left.get + value);
   endmethod
   method Bit#(8) get = right.get;
endmodule
endpackage
