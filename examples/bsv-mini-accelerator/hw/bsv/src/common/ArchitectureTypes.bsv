package ArchitectureTypes;

typedef UInt#(32) MatrixExtent;
typedef UInt#(32) JobId;
typedef UInt#(40) MemoryTxnId;

typedef struct {
    JobId jobId;
    MatrixExtent m;
    MatrixExtent n;
    MatrixExtent k;
} MatmulCommand deriving (Bits, Eq, FShow);

interface CommandSinkIfc;
    method Bool ready;
    method Action put(MatmulCommand command);
endinterface

endpackage
