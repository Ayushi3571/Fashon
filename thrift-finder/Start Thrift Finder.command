#!/bin/bash
# Double-click me in Finder to start Thrift Finder.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Thrift Finder needs Node.js (free)."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Return to close."
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.thrift-finder-ready ]; then
  echo "First run: setting things up (a few minutes, only once)..."
  npm install --no-audit --no-fund && node setup.js && touch node_modules/.thrift-finder-ready || {
    read -r -p "Setup failed (see above). Press Return to close."
    exit 1
  }
fi

if [[ " $* " == *" --phone "* ]]; then
  # Stop the Mac from idle-sleeping while the phone may be using it.
  caffeinate -i node server.js "$@"
else
  node server.js "$@"
fi
