#!/bin/sh
set -eu
export HOME=/opt/g3-home CABAL_DIR=/opt/g3-cabal
curl --fail --location --max-time 60 https://hackage.haskell.org/root.json -o /opt/g3-cabal/root-current.json
cmp /input/hackage-root-github.json /opt/g3-cabal/root-current.json
sha256sum /input/hackage-root-github.json /opt/g3-cabal/root-current.json
cp /opt/g3-cabal/config /opt/g3-cabal/config.before-root-rollover
node - <<'JS'
const fs = require('fs');
const root = JSON.parse(fs.readFileSync('/input/hackage-root-github.json'));
if (root.signed.version !== 8 || root.signed.roles.root.threshold !== 3) throw Error('unexpected root');
const keys = root.signed.roles.root.keyids.join(', ');
const path = '/opt/g3-cabal/config';
let config = fs.readFileSync(path, 'utf8');
config = config.replace('  -- root-keys:', '  root-keys: '+keys).replace('  -- key-threshold: 3', '  key-threshold: 3').replace('  -- secure: True', '  secure: True');
fs.writeFileSync(path, config);
JS
diff -u /opt/g3-cabal/config.before-root-rollover /opt/g3-cabal/config || test "$?" = 1
cabal update
cabal v1-install --user strict-concurrency==0.2.4.3
printf '\n--- resolved identity ---\n'
ghc --numeric-version
ghc-pkg list --simple-output
dpkg-query -W
find /opt/g3-home /opt/g3-cabal /var/lib/apt/lists -type f -exec sha256sum '{}' +
du -sk /usr /opt /var
