# Provenance of `packages/srd/raw/`

## Working source — markdown

The `.md` files here are a verbatim copy of the SRD 5.2.1 markdown conversion at:

- Repository: <https://github.com/downfallx/dnd-5e-srd-markdown>
- Commit: `1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4`
- Committed: 2026-01-09 16:54:05 -0500
- Retrieved: 2026-09-09
- Licence: CC-BY-4.0 (see `LICENSE`)

**These files are a third-party transcription, not the authority.** A wrong save
DC or damage die here becomes an engine bug that presents as a rules bug, so
`packages/srd/scripts/ingest.ts` validates everything it parses against a Zod
schema, and `spot-check.test.ts` asserts known values from the official PDF.

Do not hand-edit these files. If a transcription error is found, fix it in the
ingest pipeline's override table and open an issue upstream, so re-vendoring a
newer commit does not silently reintroduce it.

## Authority — official PDF

`reference/SRD_CC_v5.2.1.pdf`, published by Wizards of the Coast at
<https://www.dndbeyond.com/srd>. This is the document that wins any
disagreement. It is not parsed; it exists so spot-check values can be verified
against the real thing.

## Excluded content

Material outside the SRD (Product Identity — beholders, mind flayers, named
settings and characters) must never be added here. See `../../../ATTRIBUTION.md`.
