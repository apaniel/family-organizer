# Scoped final presence review

**CODE GO. Minimum code blockers: none found.** This reviews only the outcome/retry correction after `PRESENCE-REVIEW.md`, using `PRESENCE-CORRECTION.md` and the current runner, tests, documentation and surrounding diff. It is not installation, scheduling or delivery approval evidence. The historical local-only cron command is superseded by private-DM delivery for both output and failures.

- Regular execution prints readable Spanish for stale, uncertain, outside and cancelled conditions; these do not send the rice notice. In particular, a stale fix at execution produces human text, not silent success. Runtime/broker/configuration failures exit nonzero with stderr, rather than becoming a false skipped outcome. Task, health, identity/status and transport failure reasons remain distinct; raw broker output is withheld. `--check` retains its read-only diagnostic interface.
- Acknowledged and already-sent operations have empty stdout, preventing cron from duplicating the rice notice. The unchanged real private adapter alone sends the immutable rice body to `238615548420255@lid`, through the existing private receipt endpoint. Its zero exit requires acknowledgement; exit 75 represents explicit pre-reservation unavailability, and a later unavailable response after an uncertain reservation cannot certify non-delivery.
- An unknown claim remains unknown on a false condition or subsequent unavailable response. It reports that the notice may have been sent, never “No he enviado.” A newly unknown response stops the immediate retry loop. A previous unknown permits only one same-body/key reconciliation call when the task and presence conditions hold. There is no new key, queue or reset of evidence.
- Only known pre-reservation unavailable permits one immediate retry: at most two sender calls in that execution, with identical body/key. Both use the existing Runtime instance, 165-second total deadline and 25-second sender child limit. Durable claim and locking still precede transport; sent claims remain no-ops.
- Canonical task `amRHNnMzTUJaWThCY0ZENg`, owner/list/source identity checks, Laforja 63 coordinates, age <=300 seconds and distance + accuracy <=100 m are unchanged. The configured message remains `🍚 Sigues en casa: acuérdate de hacer arroz.` The example stays disabled with an operation-id placeholder that the parent must replace before enabling/first claim. Existing recurring arrival idle silence is unaffected: its wrapper still passes `--quiet`, and the correction does not change that runtime.

Read-only inspection of the installed production source confirms the actual execution path: `cron/scheduler_script.py` retains redacted stderr and exit code in its failed-script result; `cron/scheduler.py::_run_no_agent_job` wraps that result in an error alert, before any agent/model execution. Nonempty successful stdout is delivered, while empty successful stdout is suppressed. The scheduler selects `failure_deliver` for failures. `cron/scheduler_delivery.py` checks adapter results, returns delivery errors, and the scheduler records delivery errors/outcomes separately from script success. Thus visible failure delivery is supported without a core change or LLM/approval bypass. This source inspection does **not** establish that the live WhatsApp callback/receiver is healthy or that a diagnostic was received; parent verification of the actual callback and recorded delivery status remains required.

Validation performed here:

```sh
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -p test_presence.py -v
git diff --check
```

**11 tests passed in 7.401 seconds; no failures or skips.** Diff whitespace check passed. The whole tracked diff and presence files were inspected for compatibility; no additional broad rewrite is needed. The parent's reported fresh 85-test full-suite pass was not rerun in this scoped review.

Remaining parent sequence: CODE GO -> PR, CI and merge -> exact merged-main installation -> replace placeholder while preserving body/identity/evidence -> verified installed readiness and real read-only preflight -> new private-DM one-shot in five minutes, plus callback/receiver verification. Healthy brokers with a stale baseline permit the authorized attempt; read failures must be reported accurately. The user's “si” already authorizes that retry after verified installation. No timer has been created by this review.

Parent-only command, recorded for later use and **not executed**:

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/hermes cron create 'in 5m' --name location-presence-once --script location-presence-once.sh --no-agent --deliver whatsapp:238615548420255@lid --failure-deliver whatsapp:238615548420255@lid
```

Only this review file was written. No source edits, commit, push, live client calls, sends, installation, profile/config/core changes or cron creation occurred.
