package MemorySubsystem;

import Scratchpad::*;

interface MemorySubsystemIfc;
    interface ScratchpadIfc#(1024, Bit#(128)) activation;
    interface ScratchpadIfc#(1024, Bit#(128)) weight;
    interface ScratchpadIfc#(1024, Bit#(256)) accumulator;
endinterface

module mkMemorySubsystem(MemorySubsystemIfc);
    ScratchpadIfc#(1024, Bit#(128)) activationMemory <- mkScratchpad;
    ScratchpadIfc#(1024, Bit#(128)) weightMemory <- mkScratchpad;
    ScratchpadIfc#(1024, Bit#(256)) accumulatorMemory <- mkScratchpad;

    interface activation = activationMemory;
    interface weight = weightMemory;
    interface accumulator = accumulatorMemory;
endmodule

endpackage
