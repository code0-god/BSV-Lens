package SystolicArray;

interface SystolicArrayIfc;
    method Action start;
    method Bool done;
endinterface

// @arch.label Systolic Array
module mkSystolicArray(SystolicArrayIfc);
    Reg#(Bool) running <- mkReg(False);
    Reg#(UInt#(16)) cycle <- mkReg(0);

    rule step(running);
        cycle <= cycle + 1;
        if (cycle == 15) running <= False;
    endrule

    method Action start if (!running);
        running <= True;
        cycle <= 0;
    endmethod
    method Bool done = !running;
endmodule

endpackage
