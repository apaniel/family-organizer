#!/bin/bash
set -euo pipefail
export HERMES_HOME=/home/hermes/.hermes
exec /home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/presence_runner.py --config "${LOCATION_PRESENCE_CONFIG:-/home/hermes/.hermes/state/location-presence/config.json}" "$@"
