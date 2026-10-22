# Voice fixtures

`order-extraction.cases.ts` holds the text-level acceptance cases. They assume a perfect transcript and measure **order extraction only**.

Transcription accuracy has to be measured separately, on real recordings (phase 3):

1. Record each case (and more) from at least 5 real customers or staff, on the actual tablet, in the store, with normal background noise. Get consent and use fictional order content.
2. Save the files as `recordings/<caseId>-<speaker>.webm` (not committed; they are voice data).
3. Run the evaluation script (phase 3) per STT provider. It reports transcription WER/CER against the reference text, and extraction accuracy on the STT output.

Voice recognition must not be called production-ready until this has been done with real users.
