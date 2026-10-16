# Release artifact — verification record, 2026-10-16

**Scope:** verify the existing release process and close the CI APK evidence gap **without repeating
completed work**. No APK was generated, no test lane was re-run, and no workflow was changed to produce
this record.

**Repository:** `ci-proof/full-tree` @ **`8ee19eb3`** (= `origin`, `0/0`) · **QA project**
`bpybjrjenwccowvtrevu` · **production** `gkswcfljxlutkfdvvqng` — never read or written.

---

## 0. Verdict

**RELEASE ARTIFACT: DONE — VERIFIED (EVIDENCE REUSED).** A successful GitHub Actions run has already
produced a signed, retrievable APK for the intended staging release source. It was downloaded and
verified against GitHub's own record (size **and** digest) and against the packaged content (package,
version name, environment target); no workflow fix was needed, so none was made, no APK was generated
and no test lane was re-run.

| Gate item | Result |
|---|---|
| Workflow completed successfully | **✓** run `38802733453`, `success`, 47m 15s, both jobs ✓ |
| APK artifact exists and is retrievable | **✓** release `apk-build-389` → `app-release.apk`, 44,046,488 bytes, downloaded |
| Artifact corresponds to the intended commit | **✓** built `31641ecf`; packaged app source identical to HEAD (empty diff) |
| Package identity and version are correct | **✓** `com.agrishop.app`, versionName `1.0` (versionCode not readable from CI APK — §5.2) |
| Intended QA/staging configuration, not production | **✓** bundle stamps the QA project; production named once, in the contract table |

## 1. Evidence reused, not repeated

| Evidence | Value | Reuse basis |
|---|---|---|
| `build-apk.yml` run | **38802733453** — `success`, **47m 15s** | the released artifact is the output of this run; nothing in the app source has changed since (§3) |
| Run's commit | `31641ecf434db2e71a9ca7ace3c91c28e684bb6c` | authoritative commit of the artifact |
| Job 1 *Run Tests* | **✓** — unit tests, integration suites, Playwright E2E all ✓ | this is the release gate the artifact passed |
| Job 2 *Build APK* | **✓** — keystore decode, signing config, `assembleRelease`, fingerprint derived from the signed APK, release created | the build itself |
| Local APK / local release-signed artifact | owner-accepted interim deliverable (2026-10-15) | superseded as the primary artifact by the CI release above; kept as the decision record |
| Unit / integration / E2E suites | not re-run | no `src/` change since the run; re-running would repeat green evidence (the repository's own reuse rule) |

## 2. Where the artifact actually lives, and why `artifacts: []` was never a blocker

`gh api .../actions/runs/38802733453/artifacts` returns **`total_count: 0`**. That is **by design**, and it
is why the checklist row "no CI artifact exists" mis-measured the pipeline:

* the workflow's only `actions/upload-artifact` steps are the **failure-path** Playwright report and the
  `assetlinks.json` convenience file (gated on `APP_LINK_HOST`, unset);
* the APK itself is published by `Create GitHub Release with APK` (`softprops/action-gh-release@v2`,
  `tag_name: apk-build-${{ github.run_number }}`, `files: android/app/build/outputs/apk/release/app-release.apk`,
  `make_latest: true`).

So the configured release process delivers the APK as a **GitHub Release asset**, not as a workflow
artifact. The requirement is met; the previous label was reading the wrong endpoint.

## 3. The artifact, verified

| Check | Measured | How |
|---|---|---|
| Workflow completed successfully | **✓ success**, both jobs | `gh run view 38802733453` |
| Artifact exists and is retrievable | **✓** `app-release.apk`, state `uploaded` | `gh release view apk-build-389`; `gh release download` |
| Size matches GitHub's record | **44,046,488 bytes** — identical | `ls -l` vs the API's `size` |
| Digest matches GitHub's record | **`sha256:34d12b3de9fbc04da00c8eca5df7684525d6782a7fff784c64241762dd0676be`** — identical | local `sha256sum` vs the API's `digest` |
| Is a real, complete APK | **✓** 1,129 zip entries, `AndroidManifest.xml` present | `zipfile` |
| Package identity | **✓ `com.agrishop.app`** (plus `.MainActivity`, `.fileprovider`) | manifest string pool |
| Version | **✓ versionName `1.0`** read from the packaged manifest | manifest string pool |
| Corresponds to the intended commit | **✓ app source identical to HEAD** — `git diff --stat 31641ecf..HEAD -- src/ index.html vite.config.ts package.json public/` is **empty**; every commit after `31641ecf` is tests + docs only | git |
| Built for QA/staging | **✓** `VITE_APP_ENV: staging`, `VITE_SUPABASE_PROJECT_ID: bpybjrjenwccowvtrevu` — the workflow's own comment states a missing env block is a build that cannot produce an app, and `vite.config.ts` / `envGuard.ts` enforce it | workflow + git |
| The **packaged app** targets QA, not production | **✓** inside `assets/public` (64 js files, 3.59 MB): the QA ref `bpybjrjenwccowvtrevu` appears **9 times** — including the active stamps `VITE_SUPABASE_PROJECT_ID: bpybjrjenwccowvtrevu` and `VITE_SUPABASE_URL: https://bpybjrjenwccowvtrevu.supabase.co` — while the production ref `gkswcfljxlutkfdvvqng` appears **exactly once**, inside the bundled environment-contract table (`production:{projectRef:…}`), i.e. the refusal/validation knowledge rather than a configured target | byte scan of the APK's web bundle |
| Signed, and the signature was read back | **✓** the workflow derives `assetlinks.json` *from the signed APK* and verifies the signature in the same step (`scripts/android-assetlinks.mjs`) | workflow step, ✓ in the run |

## 4. Not done, deliberately

* **No new APK was built.** A fresh dispatch is a ~47-minute job that would reproduce the same app
  source; it was not required to close this requirement.
* **No test lane was re-run.** The run's own *Run Tests* job is the release gate and it passed.
* **No workflow change was made or pushed.** There was no blocker to fix: the artifact was present and
  valid at the first check, so the instruction's conditional ("if it is missing … commit and push the
  approved workflow fix") never applied.
* **The local records for this verification are edited but not committed** — committing was not part of
  this gate, and the previous commit/push was an explicit instruction for that task only.

## 5. Limitations, stated

1. **The release's `targetCommitish` metadata reads `main`.** That field is the release action's default
   and is *not* the built commit; the authoritative commit is the run's `headSha` (`31641ecf`) and the
   release body records it (`Auto-built APK from commit ${{ github.sha }}`). Read the run, not the field.
2. **`versionCode` was not extracted from the CI APK.** It is a binary-XML integer attribute, and no
   Android SDK tool is available on this machine to read it back. Version *name* `1.0` and the package
   name were read from the manifest; the local artifact measured `versionCode 1` from the same generated
   Gradle defaults, and the CI build regenerates `android/` the same way.
3. **The release is public and marked Latest** (`make_latest: true`), which the checklist already records
   as an outward-facing side effect rather than a defect. If the owner wants the APK distributed another
   way, that is a release-policy decision, not a missing artifact.
4. **`assetlinks.json` is deliberately not in the release**, gated on the unset `APP_LINK_HOST`. The
   app's own deep-link scheme is unaffected.
5. **`31641ecf` ≠ `HEAD`** by commit id, and the equality argued above is about the **packaged app
   source**, measured by an empty diff of `src/`, `index.html`, `vite.config.ts`, `package.json` and
   `public/`. The APK bytes themselves contain the build's own bundle and are not expected to be
   reproducible byte-for-byte.

## 6. Smallest next action, if a HEAD-exact artifact is ever required

Dispatch `build-apk.yml` on `8ee19eb3` (`workflow_dispatch`) and re-run §3 against the new release tag.
That is the only step that would make the artifact's commit id equal `HEAD`; it is not needed for the
requirement as configured, because the packaged app source is already identical.
