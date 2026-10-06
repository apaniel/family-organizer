#!/usr/bin/env bash
set -euo pipefail
exec /home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/notes_runner.py --config "${LOCATION_NOTES_CONFIG:-/home/hermes/.hermes/state/location-notes/config.json}" --quiet
