#!/bin/sh
set -eu
uname -a
printf '\n--- official archive verification ---\n'
echo '3cfa843687856de304a946dbe849a497c4fdad021f0275628b8ca7b55ccf8082  /input/ghc-9.6.7-aarch64-deb10-linux.tar.xz' | sha256sum -c -
apt-get update
apt-get install -y --no-install-recommends xz-utils libnuma1 libffi-dev libncurses-dev
mkdir -p /opt/g3-ghc96-stage /opt/g3-ghc96-home /opt/g3-ghc96-probe
tar -xJf /input/ghc-9.6.7-aarch64-deb10-linux.tar.xz -C /opt/g3-ghc96-stage
cd /opt/g3-ghc96-stage/ghc-9.6.7-aarch64-unknown-linux
./configure --prefix=/opt/ghc-9.6.7
make -j1 install
cd /opt/g3-ghc96-probe
# Only this newly created container staging tree is removed.
rm -rf /opt/g3-ghc96-stage
export HOME=/opt/g3-ghc96-home CABAL_DIR=/opt/g3-cabal
export PATH=/opt/ghc-9.6.7/bin:$PATH
/opt/ghc-9.6.7/bin/ghc --numeric-version
/opt/ghc-9.6.7/bin/ghc --info
cp /recipe/ghc96-native-probe.hs ./Main.hs
/opt/ghc-9.6.7/bin/ghc -v -O2 -fasm Main.hs -o native-probe +RTS -M3500m -A32m -s -RTS
readelf -h native-probe
./native-probe
cabal v1-install --with-compiler=/opt/ghc-9.6.7/bin/ghc --with-hc-pkg=/opt/ghc-9.6.7/bin/ghc-pkg --user --jobs=1 --dry-run regex-compat==0.95.2.1 syb==0.7.2.2 old-time==1.1.0.3 split==0.2.3.5 strict-concurrency==0.2.4.3
cabal v1-install --with-compiler=/opt/ghc-9.6.7/bin/ghc --with-hc-pkg=/opt/ghc-9.6.7/bin/ghc-pkg --user --jobs=1 regex-compat==0.95.2.1 syb==0.7.2.2 old-time==1.1.0.3 split==0.2.3.5 strict-concurrency==0.2.4.3
printf '\n--- exact installed identities ---\n'
/opt/ghc-9.6.7/bin/ghc-pkg list --simple-output
/opt/ghc-9.6.7/bin/ghc-pkg dump
dpkg-query -W
find /opt/ghc-9.6.7 /opt/g3-ghc96-home -type f -exec sha256sum '{}' +
find /opt/g3-cabal/packages/hackage.haskell.org -name '*.tar.gz' -type f -exec sha256sum '{}' +
du -sk /opt/ghc-9.6.7 /opt/g3-ghc96-home /opt/g3-cabal
