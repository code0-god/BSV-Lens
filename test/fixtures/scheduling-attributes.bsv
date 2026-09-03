package SchedulingAttributes;

// (* descending_urgency = "fakeComment, fakeRule" *)
String fake = "(* execution_order = \"fakeString, fakeRule\" *)";
/* (* conflict_free = "fakeBlock, fakeRule" *) */

(* descending_urgency = "chooseFast, chooseSlow, fallback" *)
(* execution_order = "readState, writeState" *)
(* mutually_exclusive = "idle, starting, running" *)
(* conflict_free = "producer, consumer" *)
(* preempts = "reset, producer, consumer" *)
module mkSchedulingAttributes(Empty);
endmodule

endpackage
