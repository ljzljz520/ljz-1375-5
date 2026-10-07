#!/usr/bin/env bash
cd "$(dirname "$0")"
PORT="${PORT:-8000}" PYTHONPATH=. exec python3 -m app.server
