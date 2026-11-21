#!/usr/bin/env bash
# Сборка BySS для ПК: расширение (byss.xpi), установщик (BySS-Setup.exe) и файлы обновлений.
#   bash installer/build.sh 2.0.N owner/repo
# Результат — в папке out/. Нужны zip, python3 и makensis (ставится сам, если его нет).
set -euo pipefail
V="${1:?версия}"
REPO="${2:-andrewu1337-hub/BySS-PC}"
cd "$(dirname "$0")/.."
SETUP="$(tr -dc 0-9 < installer/setup-rev.txt)"
echo "BySS $V, настройки Firefox: $SETUP"

rm -rf out && mkdir -p out ext/shared/fonts
if [ ! -s ext/shared/fonts/archivo_black.ttf ]; then
  # шрифт надписи BySS — свободный (OFL)
  curl -fsSL --retry 3 -o ext/shared/fonts/archivo_black.ttf \
    "https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf" \
    || { echo "шрифт не скачался — будет запасной"; rm -f ext/shared/fonts/archivo_black.ttf; }
fi

# расширение
B=/tmp/byss-ext && rm -rf "$B" && cp -r ext "$B"
python3 - "$V" "$B/manifest.json" <<'PY'
import json, sys
p = sys.argv[2]
m = json.load(open(p, encoding='utf-8'))
m['version'] = sys.argv[1]
json.dump(m, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
(cd "$B" && zip -r -X -9 -q "$OLDPWD/out/byss.xpi" .)

REL="https://github.com/$REPO/releases/download/v$V"
printf '{"addons":{"byss@byss.app":{"updates":[{"version":"%s","update_link":"%s/byss.xpi"}]}}}\n' "$V" "$REL" > out/updates.json
printf '{"version":"%s","setup":%s}\n' "$V" "$SETUP" > out/byss.json

# установщик
if ! command -v makensis > /dev/null; then
  sudo apt-get install -y -qq nsis > /dev/null
fi
N=/tmp/byss-nsis && rm -rf "$N" && mkdir -p "$N"
cp installer/byss.nsi installer/setup.ps1 firefox/policies.template.json firefox/profile/user.js \
   firefox/profile/chrome/userChrome.css firefox/profile/chrome/userContent.css out/byss.xpi "$N/"
cp assets/byss-shield.ico "$N/byss.ico"
(cd "$N" && makensis -V2 -DVERSION="$V" -DSETUP_REV="$SETUP" byss.nsi)
cp "$N/BySS-Setup.exe" out/

# для старого BySS (Electron): он ищет latest.yml и проверяет файл по SHA-512
python3 - "$V" <<'PY'
import base64, hashlib, os, sys, datetime
f = 'out/BySS-Setup.exe'
h = base64.b64encode(hashlib.sha512(open(f, 'rb').read()).digest()).decode()
n = os.path.getsize(f)
d = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
open('out/latest.yml', 'w').write(
    "version: %s\nfiles:\n  - url: BySS-Setup.exe\n    sha512: %s\n    size: %d\npath: BySS-Setup.exe\nsha512: %s\nreleaseDate: '%s'\n"
    % (sys.argv[1], h, n, h, d))
PY
ls -la out
