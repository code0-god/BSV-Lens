#!/bin/sh
set -eu
uname -a
printf '\n--- OS ---\n'
head -100 /etc/os-release
printf '\n--- initial packages ---\n'
dpkg-query -W
apt-get update
apt-get --assume-no install --no-install-recommends ca-certificates git curl build-essential autoconf gperf flex bison pkg-config libgmp-dev tcl-dev iverilog ghc cabal-install libghc-regex-compat-dev libghc-syb-dev libghc-old-time-dev libghc-split-dev || test "$?" = 1
apt-get install -y --no-install-recommends ca-certificates git curl build-essential autoconf gperf flex bison pkg-config libgmp-dev tcl-dev iverilog ghc cabal-install libghc-regex-compat-dev libghc-syb-dev libghc-old-time-dev libghc-split-dev
export HOME=/opt/g3-home CABAL_DIR=/opt/g3-cabal
mkdir -p "$HOME" "$CABAL_DIR"
cabal user-config init
cp "$CABAL_DIR/config" "$CABAL_DIR/config.original"
# Scope: this new container only; keep secure package verification enabled.
sed -i 's|url: http://hackage.haskell.org/|url: https://hackage.haskell.org/|' "$CABAL_DIR/config"
diff -u "$CABAL_DIR/config.original" "$CABAL_DIR/config" || test "$?" = 1
cabal update
cabal v1-install --user strict-concurrency
printf '\n--- resolved packages ---\n'
ghc --numeric-version
ghc-pkg list
ghc-pkg list --simple-output
dpkg-query -W
find /var/lib/apt/lists -type f -exec sha256sum '{}' +
find /opt/g3-cabal -type f -exec sha256sum '{}' +
du -sk /usr /opt /var
