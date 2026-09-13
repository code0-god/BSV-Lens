package Control;

interface Control;
   method Action inject(Bit#(8) value);
   method Bit#(8) read;
endinterface

(* synthesize *)
module mkControl(Control);
   Reg#(Bit#(8)) count <- mkReg(0);
   Reg#(Bool) phase <- mkReg(False);

   rule tick;
      phase <= !phase;
   endrule
   (* descending_urgency = "decrement, increment" *)
   rule decrement (count > 0 && phase);
      count <= count - 1;
   endrule
   rule increment (count < 8);
      count <= count + 2;
   endrule

   method Action inject(Bit#(8) value) if (count < 4);
      count <= value;
   endmethod
   method Bit#(8) read = count;
endmodule
endpackage
