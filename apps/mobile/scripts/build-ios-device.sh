#!/bin/bash
#
# Compila l'app attendee e la installa sull'iPhone collegato.
#
# VA LANCIATO DA UN TERMINALE SUL MAC, non via SSH: la firma del codice
# ha bisogno del portachiavi di login, e una sessione SSH non ci arriva
# (`codesign` fallisce con errSecInternalComponent). Tutto il resto —
# prebuild, pod install, compilazione — funziona anche da remoto.
#
#   ./scripts/build-ios-device.sh                 # Release, autonoma
#   ./scripts/build-ios-device.sh --debug         # Debug, richiede Metro
#
# Con un Apple ID gratuito il certificato dura 7 giorni: passati quelli
# l'app smette di partire e si ricompila. Nessun abbonamento richiesto.

set -euo pipefail

cd "$(dirname "$0")/.."

CONFIGURATION="Release"
[ "${1:-}" = "--debug" ] && CONFIGURATION="Debug"

# --- toolchain (percorsi usati se non c'è già niente nel PATH) ------------

[ -d "$HOME/.local/node/bin" ] && PATH="$HOME/.local/node/bin:$PATH"
for ruby in "$HOME"/.local/portable-ruby/*/bin; do
  [ -d "$ruby" ] && PATH="$ruby:$PATH"
done
export PATH
export LANG=${LANG:-en_US.UTF-8}

command -v node >/dev/null || { echo "manca node"; exit 1; }
command -v pod  >/dev/null || { echo "manca cocoapods"; exit 1; }

# --- team di firma --------------------------------------------------------

TEAM_ID="${DEVELOPMENT_TEAM:-}"
if [ -z "$TEAM_ID" ]; then
  TEAM_ID=$(defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null \
    | sed -n 's/.*teamID = \([A-Z0-9]*\).*/\1/p' | head -1)
fi
if [ -z "$TEAM_ID" ]; then
  echo "Nessun team di firma trovato."
  echo "Apri Xcode → Settings → Accounts e aggiungi il tuo Apple ID (basta quello gratuito)."
  exit 1
fi
echo "→ team di firma: $TEAM_ID"

# --- progetto nativo ------------------------------------------------------

if [ ! -d ios ]; then
  echo "→ genero il progetto iOS"
  npx expo prebuild --platform ios --no-install
fi

# Le script phase di Xcode hanno un PATH ridotto: gli si dice dov'è node.
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local

echo "→ pod install"
(cd ios && pod install)

# Il nome del progetto lo decide `expo prebuild` a partire da app.json:
# leggerlo invece di cablarlo evita che rinominare l'app rompa lo script.
WORKSPACE=$(cd ios && ls -d *.xcworkspace | head -1)
SCHEME="${WORKSPACE%.xcworkspace}"
echo "→ workspace: $WORKSPACE (scheme $SCHEME)"

# --- build ----------------------------------------------------------------

echo "→ build $CONFIGURATION (la prima volta ci vogliono ~10 minuti)"
rm -rf ios/build
(cd ios && xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ./build \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  build)

APP="ios/build/Build/Products/$CONFIGURATION-iphoneos/$SCHEME.app"
[ -d "$APP" ] || { echo "app non trovata in $APP"; exit 1; }
echo "→ app firmata: $APP"

# --- installazione --------------------------------------------------------

UUID_RE='^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
DEVICE="${DEVICE_ID:-}"

if [ -z "$DEVICE" ]; then
  # Un Mac accoppiato con più iPhone è la norma: meglio fermarsi che
  # installare sul telefono di qualcun altro.
  AVAILABLE=$(xcrun devicectl list devices 2>/dev/null \
    | awk -v re="$UUID_RE" '/available \(paired\)/ {
        for (i = 1; i <= NF; i++) if ($i ~ re) { print $i; break }
      }')
  COUNT=$(printf '%s\n' "$AVAILABLE" | grep -c . || true)

  if [ "$COUNT" -eq 1 ]; then
    DEVICE="$AVAILABLE"
  else
    echo
    if [ "$COUNT" -eq 0 ]; then
      echo "Nessun iPhone accoppiato e disponibile. Collegalo, sbloccalo, rilancia."
    else
      echo "Ci sono $COUNT device disponibili: scegli tu quale, non indovino io."
    fi
    echo "  DEVICE_ID=<identifier> $0"
    echo
    xcrun devicectl list devices 2>/dev/null | head -20
    exit 1
  fi
fi

echo "→ installo su $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"

cat <<'FINE'

Fatto. Sull'iPhone, la prima volta:

  1. Impostazioni → Generali → VPN e gestione dispositivo → fidati dello
     sviluppatore. (Serve solo con un Apple ID gratuito.)
  2. Apri l'app e concedi: posizione "Sempre", Bluetooth, notifiche.
     Su iOS il canale radio passa da CoreLocation: senza il permesso di
     posizione l'iPhone non sente il beacon affatto.
  3. Incolla l'id dell'evento (te lo dà la console host).

Poi accendi l'ESP32 e mettiti nel raggio.
FINE
