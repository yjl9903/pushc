# Attachments and request lifecycle

## Background and goals

The original core adapter contract assumed that request preparation was synchronous and that the
same request object could be used both for platform transport and for the public receipt. That
model cannot safely prepare local attachments: preparation needs asynchronous file I/O, while raw
Base64 data must not be exposed through dry-run or receipts.

This change adds local paths and HTTP(S) attachment URLs to the public payload, sends them through
NapCat, and makes dry-run perform local preparation without interacting with the target service.

## Key decisions

- Split adapter execution into local `prepareRequest` and target-facing `dispatchRequest` phases.
- Preparation returns a serializable `receiptRequest` and a private `transportRequest`.
- Core owns receipt assembly for both successful and failed dispatches.
- NapCat reads local files and sends them as inline `base64://` message segments.
- NapCat passes HTTP(S) attachment URLs through directly and never downloads them in pushc.
- NapCat infers image, record, video, or generic file segments from filename MIME types.
- Local files are validated and read through one file handle with a bounded stream.
- Only explicit `scheme://` sources are treated as URL candidates; ordinary paths may contain `:`.
- Decoded remote basenames are reduced to a safe leaf name and reject control characters.
- Webhook rejects payloads containing attachments instead of silently ignoring them.
- Dry-run may read and encode local files, but never dispatches a request or uploads data.
- The adapter hook contract changes directly without a legacy compatibility layer.

## Technical approach

Core normalizes the payload and operation options, resolves the target, awaits local preparation,
and checks cancellation before choosing between dry-run and dispatch. Adapter hooks only receive
the caller signal; `dryRun` is not visible to adapters. A completed preparation always supplies the
request projection used by receipts, so core preserves it if cancellation prevents dispatch or if
dispatch fails or throws.

NapCat captures the send-time cwd, opens each local attachment once, validates the opened regular
file, and reads at most the validated size through a caller-cancellable stream. It limits the total
decoded local attachment size, computes SHA-256 metadata, and builds two ordered message arrays.
Only explicit `scheme://` inputs enter URL handling; HTTP(S) sources are validated and passed to
NapCat without a download, while other schemes are rejected. Remote pathname leaves are
percent-decoded when possible, retain literal percent characters when decoding is not possible,
are stripped of path separators, and are rejected if they contain control characters.
Public remote metadata omits the full URL and query. During real dispatch, a HEAD response
Content-Type refines the provisional pathname type and the final receipt request; failures fall back
to the provisional type. Independent remote probes run concurrently and their results are applied
by original attachment index, with at most eight probes active at once. Dry-run performs no remote
probe. The private array contains Base64 resource values or complete remote URLs. Text is omitted
when the payload message is blank.

The CLI accepts repeatable attachment options and permits an empty message only when attachments
are present. Architecture documents and package READMEs are updated with the final behavior.
