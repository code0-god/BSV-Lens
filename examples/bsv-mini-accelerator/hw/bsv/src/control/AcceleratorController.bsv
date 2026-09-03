package AcceleratorController;

import ArchitectureTypes::*;
import FIFOF::*;

interface AcceleratorControllerIfc;
    interface CommandSinkIfc commands;
    method Bool issueValid;
    method MatmulCommand issue;
    method Action consume;
    method ActionValue#(MatmulCommand) take;
endinterface

(* descending_urgency = "produceStatus, consumeStatus" *)
(* mutually_exclusive = "countAccepted, consumeStatus" *)
module mkAcceleratorController(AcceleratorControllerIfc);
    FIFOF#(MatmulCommand) commandQueue <- mkPipelineFIFOF;
    FIFOF#(UInt#(64)) statusQueue <- mkFIFOF;
    Reg#(UInt#(64)) acceptedCommands <- mkReg(0);

    rule countAccepted(commandQueue.notEmpty);
        acceptedCommands <= acceptedCommands + 1;
    endrule

    rule produceStatus(statusQueue.notFull);
        statusQueue.enq(acceptedCommands);
    endrule

    rule consumeStatus(statusQueue.notEmpty);
        let status = statusQueue.first;
        statusQueue.deq;
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
    method ActionValue#(MatmulCommand) take if (commandQueue.notEmpty);
        let command = commandQueue.first;
        commandQueue.deq;
        return command;
    endmethod
endmodule

endpackage
