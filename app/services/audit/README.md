# Audit service boundary

Persistent cross-plane audit records will be written through this boundary.
Events must contain identifiers and redacted metadata only—never credentials,
access codes, message bodies, or raw webhook payloads.

The persistent audit model and writer are `DEFERRED TO M2` with the first
app-owned identity workflow. Milestone 0 uses the structured server logger.

