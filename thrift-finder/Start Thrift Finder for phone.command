#!/bin/bash
# Double-click me to use Thrift Finder from your phone. A QR code will appear.
cd "$(dirname "$0")" || exit 1
exec "./Start Thrift Finder.command" --phone "$@"
