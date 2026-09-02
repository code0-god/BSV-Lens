package Scratchpad;

import BRAM::*;

interface ScratchpadIfc#(numeric type rows, type dataType);
    method Action write(Bit#(TLog#(rows)) row, dataType value);
    method Action readReq(Bit#(TLog#(rows)) row);
    method ActionValue#(dataType) readResp;
endinterface

module mkScratchpad(ScratchpadIfc#(rows, dataType)) provisos (Bits#(dataType, dataWidth));
    BRAM2Port#(Bit#(TLog#(rows)), dataType) storage <- mkBRAM2Server(defaultValue);
    Reg#(Bool) responsePending <- mkReg(False);

    rule trackRead(responsePending);
        responsePending <= False;
    endrule

    method Action write(Bit#(TLog#(rows)) row, dataType value);
        storage.portA.request.put(BRAMRequest { write: True, responseOnWrite: False, address: row, datain: value });
    endmethod

    method Action readReq(Bit#(TLog#(rows)) row) if (!responsePending);
        storage.portB.request.put(BRAMRequest { write: False, responseOnWrite: False, address: row, datain: ? });
        responsePending <= True;
    endmethod

    method ActionValue#(dataType) readResp if (responsePending);
        let value <- storage.portB.response.get;
        return value;
    endmethod
endmodule

endpackage
