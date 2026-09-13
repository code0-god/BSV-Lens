package G0Payload;
// Source-analysis audit only; no compiled hardware claim.
interface RequestsIfc;
    method Action put(Bit#(8) request);
endinterface
interface ResponsesIfc;
    method Bool valid;
    method Bit#(16) response;
endinterface
interface PortIfc;
    interface RequestsIfc requests;
    interface ResponsesIfc responses;
endinterface
module mkPort(PortIfc);
endmodule
endpackage
