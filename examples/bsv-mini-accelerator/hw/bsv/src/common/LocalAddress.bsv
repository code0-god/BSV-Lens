package LocalAddress;

typedef enum {
    LocalActivation,
    LocalWeight,
    LocalMetadata,
    LocalAccumulator
} LocalRegion deriving (Bits, Eq, FShow);

typedef struct {
    LocalRegion region;
    Bit#(8) bank;
    Bit#(16) row;
} LocalAddress deriving (Bits, Eq, FShow);

typedef struct {
    Bit#(bankWidth) bank;
    Bit#(rowWidth) row;
} BankedRow#(
    numeric type bankWidth,
    numeric type rowWidth
) deriving (Bits, Eq, FShow);

function BankedRow#(bankWidth, rowWidth) mapGlobalRow(
    UInt#(32) globalRow,
    Integer bankCount
) provisos (
    Add#(bankPadding, bankWidth, 32),
    Add#(rowPadding, rowWidth, 32)
);
    if (bankCount <= 0) begin
        return error("bank count must be positive");
    end
    else if (bankCount > (2 ** valueOf(bankWidth))) begin
        return error("bank count exceeds bank address width");
    end
    else begin
        UInt#(32) localRow = globalRow / fromInteger(bankCount);
        UInt#(33) localRowWide = zeroExtend(localRow);
        if (localRowWide >= fromInteger(2 ** valueOf(rowWidth))) begin
            return error("global row exceeds local row address width");
        end
        else begin
            Bit#(bankWidth) bank = truncate(pack(globalRow % fromInteger(bankCount)));
            Bit#(rowWidth) row = truncate(pack(localRow));
            return BankedRow { bank: bank, row: row };
        end
    end
endfunction

function LocalAddress offsetBankedAddress(
    LocalAddress base,
    UInt#(32) offset,
    Integer bankCount
);
    if (bankCount <= 0) begin
        return error("bank count must be positive");
    end
    else begin
        UInt#(40) baseBank = zeroExtend(unpack(base.bank));
        UInt#(40) linear =
            zeroExtend(unpack(base.row)) * fromInteger(bankCount)
            + baseBank
            + zeroExtend(offset);
        UInt#(40) bank = linear % fromInteger(bankCount);
        UInt#(40) row = linear / fromInteger(bankCount);
        return LocalAddress {
            region: base.region,
            bank: truncate(pack(bank)),
            row: truncate(pack(row))
        };
    end
endfunction

endpackage
