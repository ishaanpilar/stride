#!/usr/bin/env bash
# Build Stride for iPhone with a free Apple ID ("Personal Team") and install it
# on a connected iPhone. Free provisioning expires after 7 days: run this again
# to refresh it. Your data on the phone is kept across reinstalls.
#
# Usage (from repo root or anywhere):
#   bash apps/mobile/scripts/ios-personal-install.sh            # build + install
#   PREBUILD=1 bash apps/mobile/scripts/ios-personal-install.sh # regenerate ios/ first
#   TEAM_ID=XXXXXXXXXX DEVICE_ID=<udid> ...                      # override detection
#
# A Personal Team cannot sign CloudKit (iCloud database) or push notifications,
# so those entitlements are stripped. Sync uses an iCloud Drive *folder* instead
# (Settings -> Sync -> File). App Groups are kept unless STRIP_APP_GROUPS=1.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$MOBILE_DIR/ios"
DERIVED="$IOS_DIR/build/personal"
cd "$MOBILE_DIR"

if [[ "${PREBUILD:-0}" == "1" || ! -d "$IOS_DIR/Stride.xcodeproj" ]]; then
  echo "==> Generating iOS project (expo prebuild)"
  CI=1 ../../node_modules/.bin/expo prebuild --platform ios --no-install
  # prebuild wipes ios/, including the tracked Xcode Cloud script
  git checkout -- ios/ci_scripts 2>/dev/null || true
  (cd "$IOS_DIR" && pod install)
fi

echo "==> Patching expo-constants build phase for paths with spaces"
# expo-constants' phase runs `bash -l -c "$PODS_TARGET_SRCROOT/..."` and its script
# calls `basename $PROJECT_DIR` unquoted; with a space in the repo path ("Personal
# Organisation") the first fails and the second silently skips app.config.
# Replace the phase with an equivalent, fully quoted call.
python3 - "$IOS_DIR/Pods/Pods.xcodeproj/project.pbxproj" <<'PY'
import sys
path = sys.argv[1]
src = open(path).read()
old = 'shellScript = "bash -l -c \\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"";'
new = ('shellScript = "bash -l -c \'cd \\"$3\\" && \\"$1\\" \\"$2\\" \\"$3\\" \\"$4\\"\' _ '
       '\\"$PODS_TARGET_SRCROOT/../scripts/with-node.sh\\" '
       '\\"$PODS_TARGET_SRCROOT/../scripts/getAppConfig.js\\" '
       '\\"$PROJECT_DIR/../..\\" \\"$CONFIGURATION_BUILD_DIR/EXConstants.bundle\\"";')
if old in src:
    open(path, 'w').write(src.replace(old, new))
    print("patched")
elif new in src:
    print("already patched")
else:
    sys.exit("expo-constants script phase not found; check Pods project")
PY

# Same problem in the app's "Bundle React Native code and images" phase: it runs
# the bundler via unquoted backticks, so the path splits at the space.
python3 - "$IOS_DIR/Stride.xcodeproj/project.pbxproj" <<'PY'
import sys
path = sys.argv[1]
src = open(path).read()
call = ('\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve('
        '\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\"')
old, new = '`' + call + '`', '\\"$(' + call + ')\\"'
if old in src:
    open(path, 'w').write(src.replace(old, new))
    print("patched bundle phase")
elif new in src:
    print("bundle phase already patched")
else:
    sys.exit("bundle phase not found; check Stride.xcodeproj")
PY

echo "==> Removing entitlements a free Apple ID cannot sign"
strip() { /usr/libexec/PlistBuddy -c "Delete :$2" "$1" >/dev/null 2>&1 || true; }
for key in aps-environment com.apple.developer.icloud-container-identifiers \
           com.apple.developer.icloud-services com.apple.developer.ubiquity-kvstore-identifier; do
  strip "$IOS_DIR/Stride/Stride.entitlements" "$key"
done
if [[ "${STRIP_APP_GROUPS:-0}" == "1" ]]; then
  for f in "$IOS_DIR"/*/*.entitlements; do strip "$f" com.apple.security.application-groups; done
fi

if [[ -z "${TEAM_ID:-}" ]]; then
  # An "Apple Development" certificate's OU field is the team id.
  TEAM_ID="$(security find-certificate -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1 || true)"
fi
if [[ -z "${TEAM_ID:-}" ]]; then
  # No certificate yet (fresh account): read the team Xcode knows about.
  # xcodebuild -allowProvisioningUpdates then creates the certificate.
  TEAM_ID="$( { defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null
                defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null; } \
    | sed -n 's/.*teamID = \"*\([A-Z0-9]\{10\}\)\"*;.*/\1/p' | head -1 || true)"
fi
if [[ -z "${TEAM_ID:-}" ]]; then
  echo "No team found. Add your Apple ID in Xcode > Settings > Accounts, then pass TEAM_ID=<10 chars>" >&2
  echo "(Xcode > Settings > Accounts > your Apple ID > Personal Team shows the ID.)" >&2
  exit 1
fi

if [[ -z "${DEVICE_ID:-}" ]]; then
  DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null \
    | awk '/^== Devices ==/{d=1;next} /^==/{d=0} d && /iPhone/ && !/Simulator/' \
    | sed -n 's/.*(\([0-9A-F-]\{20,\}\))$/\1/p' | head -1 || true)"
fi
if [[ -z "${DEVICE_ID:-}" ]]; then
  # Wirelessly paired iPhones show up in devicectl but not always in xctrace.
  DEVICE_ID="$(xcrun devicectl list devices 2>/dev/null \
    | awk '/iPhone/ && /available/ && /physical/' \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
fi
if [[ -z "${DEVICE_ID:-}" ]]; then
  echo "No iPhone found. Connect it by cable, unlock it, tap Trust, enable Developer Mode." >&2
  exit 1
fi
echo "==> Team $TEAM_ID, device $DEVICE_ID"

echo "==> Building Release (this takes a few minutes)"
xcodebuild -workspace "$IOS_DIR/Stride.xcworkspace" -scheme Stride -configuration Release \
  -destination "id=$DEVICE_ID" -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
  build | tail -n 30

APP="$DERIVED/Build/Products/Release-iphoneos/Stride.app"
echo "==> Installing $APP"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
echo "Done. First launch: iPhone Settings > General > VPN & Device Management > trust your Apple ID."
