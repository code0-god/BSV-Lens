package AcceleratorController;

import ArchitectureTypes::*;
import FIFOF::*;

interface AcceleratorControllerIfc;
    interface CommandSinkIfc commands;
    method Bool issueValid;
    method MatmulCommand issue;
    method Action consume;
endinterface

module mkAcceleratorController(AcceleratorControllerIfc);
    FIFOF#(MatmulCommand) commandQueue <- mkPipelineFIFOF;
    Reg#(UInt#(64)) acceptedCommands <- mkReg(0);

    rule countAccepted(commandQueue.notEmpty);
        acceptedCommands <= acceptedCommands + 1;
    endrule

    interface CommandSinkIfc commands;
        method Bool ready = commandQueue.notFull;
        method Action put(MatmulCommand command) if (commandQueue.notFull);
            commandQueue.enq(command);
        endmethod
    endinterface

    method Bool issueValid = commandQueue.notEmpty;
    method MatmulCommand issue if (commandQueue.notEmpty);
        return commandQueue.first;
    endmethod
    method Action consume if (commandQueue.notEmpty);
        commandQueue.deq;
    endmethod
endmodule

endpackage
