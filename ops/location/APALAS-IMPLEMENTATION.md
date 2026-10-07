# Opt-in Apalas arrival delivery

Uncommitted changes on `feat/location-apalas-hola`, based on
`78f439268a4d4d002ef6063725ea0f5fe775226b`. All edits are confined to
`ops/location`; no installation, live Tasks/location/delivery operation, config,
cron, bridge/plugin, protected service or Cloudflare change was performed.

`google_notes.py` accepts optional `delivery:{destination,message}` on v1/v2
arrival rules. Both fields are explicit; destinations are only private
`238615548420255@lid` and original Apalas `120363411293061762@g.us`.
Message is plain nonblank text, at most 2000 Unicode characters, without control
characters or rule delimiters. No implicit retargeting. Existing private rules,
v2 presence rules and malformed-rule private diagnostics retain their behavior.

`delivery.py` validates and POSTs exactly `{key,destination,component}` to loopback
port 3000 `/family/delivery`; component is exactly `{id,kind,content}`, with id
identical to the 64-hex key, kind `text`, and only the explicit message as content.
GET `/family/delivery/<key>` reconciles unknown/acknowledged/absent. Absent permits
only the same body/key POST. Group acknowledgement is server acceptance, not
receipt by every group member. Installed `bridge-source/durable_delivery.js` was
inspected read-only. Only documented pre-reservation failure responses are
retryable; disabled, conflict, timeout, socket error and send rejection stay
unknown. Prior uncertainty is never converted to rejection.

`notes_runner.py` freezes transport/schema/body (including destination/message/key)
in `notes_state.py` before transport. Old claims without these fields capture the
exact existing private body/key, including the generic-message fallback. Unknown
claims never get a new key or route. Changed rules stop transport while retaining
uncertainty. One ACK consumes the canonical task across revisions. Arrival
freshness <=300 seconds, outside baseline <=900 seconds and no first-inside alert
with nearby=false remain unchanged. Google Tasks remains canonical; no new store,
cron or server is introduced.

`author_notes.py` rejects changed delivery once the private ledger records any
claimed/consumed episode. It holds the existing private lock through notes-only
update/readback using a read-only ledger; missing/corrupt/unsafe/busy state stops
authoring. `--replace-trailing-private-narrative` replaces only an exact,
parent-supplied trailing paragraph outside the rule, preserving unrelated bytes
and trailing root metadata. It never guesses the old narrative.
`prepare-release.py` includes `delivery.py` and this document in its allowlist;
`install-main.py` needs no change and preserves existing config/state.

Tests are in `test_apalas.py` and `test_apalas_cli.py`: actual parser and author
CLI, private compatibility, group payload privacy, immutable claims/restart,
crash after claim, changed route/message, unknown then ACK, pre-reservation
classification, arbitrary destination rejection, canonical broker mocks and the
actual runner/sender CLI against an offline synthetic group journal.

## Parent commands after review and release

From an exact clean reviewed main checkout, install only after parent review:

```sh
/home/hermes/.hermes/hermes-agent/venv/bin/python ops/location/install-main.py \
  --repo "$PWD" --commit REVIEWED_FULL_MAIN_COMMIT
```

Read-only preflight, prints status only and makes no Tasks/location/bridge call:

```sh
/home/hermes/.hermes/hermes-agent/venv/bin/python \
  /home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/author_notes.py \
  --claim-status --state /home/hermes/.hermes/state/location-notes/state.json \
  --id NnZKdzZtbkNoaVJwN205ZQ --list-id WHh4eXR1cG94dGRueW1VdQ
```

Proceed only on `unclaimed`; claimed/unavailable means stop without resetting,
rearming, duplicating or completing the task. Author repeats this check under lock.
The current task is paused with no rule block. Parent must use a current canonical
readback, preserving all unrelated notes, root metadata, identity, open status and
sourceKey. If an exact trailing pause/private suffix exists outside the block and
before root metadata, set `CONFIRMED_TRAILING_PRIVATE_NARRATIVE` to those exact
current bytes and pass the suffix flag below. Do not use a historical backup
paragraph. If no exact trailing suffix exists, deliberately omit both the variable
assertion and `--replace-trailing-private-narrative` argument; no replacement text
is invented. The narrow replacement preserves the other notes and root metadata.

Latest user instruction overrides the historical place: CASA, Carrer de Laforja63
Barcelona, confirmed center 41.3970791,2.1465232, radius 100 m. The following
adds an explicit v2 arrival revision 2 rule to the same paused task; it does not
create a task. Parent may update the title separately. Coordinates stay in the
private rule; the original Apalas group receives exactly `Hola`.
Parent runs the command only after independent review and authorized installation:

```sh
: "${CONFIRMED_TRAILING_PRIVATE_NARRATIVE:?Set exact trailing private paragraph from parent canonical readback}"
/home/hermes/.hermes/hermes-agent/venv/bin/python \
  /home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/author_notes.py \
  --id NnZKdzZtbkNoaVJwN205ZQ --list-id WHh4eXR1cG94dGRueW1VdQ \
  --source-key whatsapp:location:test:horitzo:20261005 \
  --name CASA --address 'Carrer de Laforja63 Barcelona' \
  --maps-url 'https://maps.google.com/?q=41.3970791,2.1465232' \
  --latitude 41.3970791 --longitude 2.1465232 \
  --radius 100 --trigger arrival --nearby false --revision 2 \
  --state /home/hermes/.hermes/state/location-notes/state.json \
  --delivery-destination 120363411293061762@g.us --delivery-message Hola \
  --replace-trailing-private-narrative "$CONFIRMED_TRAILING_PRIVATE_NARRATIVE"
```

Pause/resume is a never-claimed configuration change, not claimed rearm. Only
stopped episode=0/attempts=0 items without dispatch, legacy, message or evaluation
evidence can resume on a changed valid arrival fingerprint with nearby=false.
The runner clears phase/lastfix/outside_at and requires a new fresh outside fix
then inside; first inside does not alert and stale fixes establish no baseline.
Episode=1, claimed, consumed, unknown and failed retry evidence never resumes.
No live ledger deletion or reset is part of this handoff.

No enable/cron/live smoke command is part of this implementation.

## Verification

Scoped NO-GO correction, 2026-10-07 (offline, not release approval):

- Focused actual source/CLI suite: **19 tests passed in 4.771s**.
- Canonical location suite, approved Hermes venv first on PATH and bytecode
  disabled: **121 tests passed in 66.557s**, exit 0. Installer/release checks
  operate only on temporary offline fixture roots.
- AST syntax: **28 Python modules**; `bash -n`: **3 scripts and 3 handoff
  blocks**; `git diff --check`: **passed**.
- New regression coverage: normal removal -> stopped -> canonical mocked author
  -> fresh outside -> inside exact original-group Hola; first-inside silence;
  stale fix leaves no baseline; malformed/unchanged notes do not resurrect;
  stopped claimed/episode=1 and consumed/unknown/failed/retry evidence stays
  protected. CASA geometry is private to the rule and absent from group payload.
- Edits for this correction are only notes_runner.py, test_apalas.py and this
  handoff. No live state/config/cron/task change, installation, send, commit,
  push or merge was performed. Independent NO-GO remains pending re-review;
  these results are not self-approval.

Original implementation verification follows (historical results):

- Canonical `python3 -m unittest discover -s ops/location -v`, with the approved
  Hermes venv first on PATH (cryptography 50.0.0): **117 tests passed in 68.007s**,
  including 15 new focused Apalas checks. Earlier standalone focused run: 12/12
  passed before three additional checks were added to the canonical suite.
- Initial full run: 112 tests, four failures (private JSON wire order after restart
  and three release allowlist expectations). Both issues were corrected; the next
  full run passed 114 tests, followed by the final canonical 117-test pass.
- `npm test -- --maxWorkers=1`: **332 tests in 41 files passed**, 115.87s.
  `tsc --noEmit`: **exit 0**, no diagnostics. Because this checkout has no
  node_modules, these ran in a temporary source snapshot using existing
  family-location-runtime dependencies; both package.json and package-lock.json
  matched byte-for-byte (lock SHA-256
  `1ad5e5345a82d6034f092467d294e91c06a5ca17d1c5df101a54c981d12b00f5`).
  No npm installation or checkout symlink was made.
- Python AST syntax for all location modules, `bash -n` for all location shell
  scripts and the handoff shell commands, and `git diff --check`: **passed**.
- Release/installer tests use temporary offline fixtures only. No live test,
  Cloudflare build/deploy, installation, task patch or WhatsApp send occurred.

Offline results do not establish live location precision or delivery. Independent
parent review and installation precede the explicit canonical author command.
