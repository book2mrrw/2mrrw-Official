#!/bin/sh
# Point apt at snapshot.debian.org for one fixed moment, then refresh. Every
# snapshot is kept permanently, so an image rebuilt years later — on amd64 or
# arm64 — resolves exactly the same Debian 13 packages. Release signatures are
# still verified (the snapshot serves Debian's signed Release files).
set -eu
moment="$1"
cat > /etc/apt/sources.list.d/debian.sources <<SOURCES
Types: deb
URIs: http://snapshot.debian.org/archive/debian/${moment}
Suites: trixie trixie-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/${moment}
Suites: trixie-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
SOURCES
rm -f /etc/apt/sources.list
# A snapshot's Release files are old by design.
echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99snapshot
apt-get update
