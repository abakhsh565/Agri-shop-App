# ADR-001 — Cross-Platform Mobile Framework

Status: **SUPERSEDED by ADR-006**

Original decision: Use Flutter + Dart for the mobile application.

Reason for supersession: The project is built and maintained solo, via AI coding tools, without a native mobile engineer. Flutter/Dart requires the founder to debug in an unfamiliar language and toolchain when the AI agent gets stuck. React Native + Expo (ADR-006) has a larger AI-training-data footprint, a simpler build/APK pipeline (EAS Build, no local Android Studio requirement), and is JavaScript/TypeScript — the same language as the backend, reducing the number of ecosystems a non-technical founder has to reason about.

This entry is preserved for history, not deleted, per the project's no-hard-delete philosophy applied to decisions as well as data.
