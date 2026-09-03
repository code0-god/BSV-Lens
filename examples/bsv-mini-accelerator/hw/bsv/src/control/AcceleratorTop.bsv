package AcceleratorTop;

import AcceleratorController::*;
import MemorySubsystem::*;
import VectorQuantizer::*;
import SystolicArray::*;

interface AcceleratorTopIfc;
    interface AcceleratorControllerIfc control;
endinterface

// @arch.group control
// @arch.label Mini Accelerator Top
// @arch.entry
module mkAcceleratorTop(AcceleratorTopIfc);
    AcceleratorControllerIfc controller <- mkAcceleratorController;
    MemorySubsystemIfc memory <- mkMemorySubsystem;
    VectorQuantizerIfc quantizer <- mkVectorQuantizer;
    SystolicArrayIfc arrayLane0 <- mkSystolicArray;
    SystolicArrayIfc arrayLane1 <- mkSystolicArray;

    rule dispatch(controller.issueValid && quantizer.valid);
        arrayLane0.start;
        arrayLane1.start;
        controller.consume;
    endrule

    interface control = controller;
endmodule

endpackage
