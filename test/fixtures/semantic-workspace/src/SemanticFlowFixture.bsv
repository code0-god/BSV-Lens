package SemanticFlowFixture;

// Test-only semantic flow fixture. This is not production source.

interface SchedulerIfc#(numeric type arrayDim);
    method Bool startReady;
    method Action start(AquaMatmulDescriptor descriptor);
    method Bool publishReady;
    method Action publishStripe(ActivationStripe stripe);
    method Bool workValid;
    method ArrayWork#(arrayDim) currentWork;
    method Action completeWork;
    method Bool lookaheadValid;
    method ActivationStripe lookaheadStripe;
    method Bool completionValid;
    method StripeCompletion completion;
    method Action consumeCompletion;
endinterface

module mkScheduler(SchedulerIfc#(arrayDim));
    Reg#(Bool) active <- mkReg(False);
    FIFOF#(StripeCompletion) completions <- mkFIFOF;

    method Bool startReady = !active;
    method Action start(AquaMatmulDescriptor descriptor) if (!active);
        active <= True;
    endmethod
    method Bool publishReady = active;
    method Action publishStripe(ActivationStripe stripe) if (active);
        noAction;
    endmethod
    method Bool workValid = active;
    method ArrayWork#(arrayDim) currentWork if (active);
        return makeArrayWork;
    endmethod
    method Action completeWork if (active);
        active <= False;
        completions.enq(makeCompletion);
    endmethod
    method Bool lookaheadValid = active;
    method ActivationStripe lookaheadStripe if (active);
        return makeStripe;
    endmethod
    method Bool completionValid = completions.notEmpty;
    method StripeCompletion completion if (completions.notEmpty);
        return completions.first;
    endmethod
    method Action consumeCompletion if (completions.notEmpty);
        completions.deq;
    endmethod
endmodule

interface WorkerIfc#(numeric type arrayDim);
    method Bool startReady;
    method Action start(
        ArrayWork#(arrayDim) work,
        Bool priorAccumulation
    );
    method Bool fragmentValid;
    method KFragment currentFragment;
    method Action consumeFragment;
    method Bool lookaheadValid;
    method KFragment lookaheadFragment;
    method Bool doneValid;
    method Action consumeDone;
endinterface

module mkWorker(WorkerIfc#(arrayDim));
    Reg#(Bool) active <- mkReg(False);

    method Bool startReady = !active;
    method Action start(
        ArrayWork#(arrayDim) work,
        Bool priorAccumulation
    ) if (!active);
        active <= True;
    endmethod
    method Bool fragmentValid = active;
    method KFragment currentFragment if (active);
        return makeFragment;
    endmethod
    method Action consumeFragment if (active);
        active <= False;
    endmethod
    method Bool lookaheadValid = active;
    method KFragment lookaheadFragment if (active);
        return makeFragment;
    endmethod
    method Bool doneValid = !active;
    method Action consumeDone if (!active);
        noAction;
    endmethod
endmodule

interface LooseIfc;
    method Bit#(8) orphan;
endinterface

module mkLoose(LooseIfc);
    // Deliberately unresolved interface implementation for Gate B UI coverage.
endmodule

module mkFlowTop(Empty);
    SchedulerIfc#(16) scheduler <- mkScheduler;
    SchedulerIfc#(16) schedulerMirror <- mkScheduler;
    WorkerIfc#(16) worker <- mkWorker;
    LooseIfc loose <- mkLoose;
    Reg#(Bool) priorAccumulation <- mkReg(False);

    rule bridge(
        scheduler.workValid
        && worker.startReady
    );
        let work = scheduler.currentWork;
        worker.start(work, priorAccumulation);
        scheduler.completeWork;
    endrule
endmodule

endpackage
