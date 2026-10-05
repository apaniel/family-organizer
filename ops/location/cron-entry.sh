#!/usr/bin/env bash
set -euo pipefail
export HERMES_HOME=/home/hermes/.hermes
exec /home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/scheduled_cycle.py --config /home/hermes/.hermes/state/location/config.json --quiet
