package G0Unknown;
// Unresolved interface is intentional: payload absence cannot be established.
interface OpaqueIfc;
    interface VendorIfc opaque;
endinterface
module mkOpaque(OpaqueIfc);
endmodule
endpackage
