package PureFunctionFixture;

// Gate C fixture: pure source functions must not create hardware roots or protocols.
function Bit#(8) chooseValue(Bit#(8) value, Bool useInput);
    if (useInput) begin
        return value;
    end
    else begin
        let value = 8'h2a;
        return value;
    end
endfunction

function Bit#(8) callChoose(Bit#(8) inputValue, Bool enabled);
    return chooseValue(inputValue, enabled);
endfunction

function String sourceMarkup;
    return "<img src=x onerror=globalThis.__sourceInjected=True></script>";
endfunction

endpackage
