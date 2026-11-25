#!/usr/bin/env bash
# Builds scene/main.cpp into web/orchestra-engine.{js,wasm} with the Strata
# 0.10.0 web kit. Downloads the release into the gitignored .strata/ once.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
VER=0.10.0
SHA=bb86b974c7e0309db91625ba5ee157273704c77d93f4338c8a63ee625e3d56de
TAR=".strata/strata-$VER-wasm32-emscripten.tar.gz"
# shellcheck disable=SC1091
. "${AGENTVIZ:-/root/agentviz}/tools/emsdk-env.sh"
mkdir -p .strata
if [ ! -f "$TAR" ]; then
  gh release download "v$VER" -R Preponderous-Software/strata -p "$(basename "$TAR")" -D .strata
fi
echo "$SHA  $TAR" | sha256sum -c -
[ -f .strata/kit/build-kit.sh ] || tar -xzf "$TAR" -C .strata
STRATA_TARBALL="$TAR" STRATA_SHA256="$SHA" .strata/kit/build-kit.sh scene/kit.conf
