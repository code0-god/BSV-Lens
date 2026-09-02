package VectorQuantizer;

interface VectorQuantizerIfc;
    method Action put(Vector#(16, Float) activation);
    method Bool valid;
    method Vector#(16, Int#(8)) first;
    method Action consume;
endinterface

// @arch.label Vector Quantizer
module mkVectorQuantizer(VectorQuantizerIfc);
    Reg#(Bool) outputValid <- mkReg(False);
    Reg#(Vector#(16, Int#(8))) outputValues <- mkRegU;

    rule quantize(!outputValid);
        outputValid <= True;
    endrule

    method Action put(Vector#(16, Float) activation) if (!outputValid);
        outputValues <= replicate(0);
    endmethod
    method Bool valid = outputValid;
    method Vector#(16, Int#(8)) first if (outputValid) = outputValues;
    method Action consume if (outputValid);
        outputValid <= False;
    endmethod
endmodule

endpackage
