# ADR-001 — Cross-Platform Mobile Framework

Status: Superseded by ADR-006 (2026-08-18)

> Superseded: the product owner chose to ship the existing React app as an
> installable PWA (works on Android and iOS from one codebase) rather than a
> native Flutter app. See ADR-006. Retained for historical record per ADR-004.

Decision (historical): Use Flutter + Dart for the mobile application unless explicitly changed before implementation.

Reason: The product requires iOS and Android with a single mobile codebase and consistent UI implementation.

Alternative considered: React Native + TypeScript.

Change policy: A framework change requires a new ADR documenting rationale, migration impact, cost, and effect on existing designs/code.
