# ADR-005 — Modular Monolith First

Status: Accepted

Decision: Start with a modular monolith and clear domain boundaries.

Reason: The initial shop has approximately 3–4 employees and the product is an internal retail/POS system. Microservices would add operational complexity without a demonstrated need.

Future: Extract a module only when scale, reliability, team boundaries, or deployment requirements justify it.
