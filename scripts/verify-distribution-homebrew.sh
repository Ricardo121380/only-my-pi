#!/bin/bash
set -euo pipefail
# Never change the operator's local Homebrew installation.
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_OS:-}" = macOS
candidate="$1"
evidence="$2"
mkdir "$evidence"
exec > >(tee "$evidence/lifecycle.log") 2>&1
export HOMEBREW_NO_AUTO_UPDATE=1
brew tap-new --no-git omp-acceptance/local
formula="$(brew --repository)/Library/Taps/omp-acceptance/homebrew-local/Formula/only-my-pi.rb"
mkdir "$evidence/previous"
gh release download v0.4.0-preview.1 --repo Ricardo121380/only-my-pi --pattern only-my-pi.rb --dir "$evidence/previous"
gh attestation verify "$evidence/previous/only-my-pi.rb" --repo Ricardo121380/only-my-pi --source-digest 38e71adc8c2c52cc332db288f5dcdd14f73bd8cb --signer-digest 38e71adc8c2c52cc332db288f5dcdd14f73bd8cb --source-ref refs/heads/main --signer-workflow Ricardo121380/only-my-pi/.github/workflows/distribution-candidate.yml --deny-self-hosted-runners
cp "$evidence/previous/only-my-pi.rb" "$formula"
if brew help trust >/dev/null 2>&1; then brew trust --formula omp-acceptance/local/only-my-pi; fi
mkdir -p "$evidence/user/.pi/agent/sessions"
export PI_CODING_AGENT_DIR="$evidence/user/.pi/agent"
printf '%s\n' 'retained session fixture' > "$PI_CODING_AGENT_DIR/sessions/preserve.txt"
printf '%s\n' '{}' > "$PI_CODING_AGENT_DIR/settings.json"
brew install --formula omp-acceptance/local/only-my-pi
omp --version | /usr/bin/grep -F 'only-my-pi 0.4.0-preview.1'
python3 - "$candidate" "$formula" <<'PY'
import sys,json,hashlib
from pathlib import Path
c=Path(sys.argv[1]);r=json.loads((c/'build-receipt.json').read_text());f=(c/'only-my-pi.rb').read_text()
assert r['version']=='0.4.0-preview.2'
assert 'sha256:'+hashlib.sha256(f.encode()).hexdigest()==r['homebrew']['sha256']
base='https://github.com/Ricardo121380/only-my-pi/releases/download/v'+r['version']
assert f.count(base)==2
Path(sys.argv[2]).write_text(f.replace(base,c.as_uri()))
PY
check_identity() {
  omp admin version --json > "$evidence/$1-version.json"
  omp admin doctor --json > "$evidence/$1-doctor.json"
  python3 - "$candidate" "$evidence/$1-version.json" "$evidence/$1-doctor.json" <<'PY'
import sys,json
from pathlib import Path
r=json.loads((Path(sys.argv[1])/'build-receipt.json').read_text())
for p in sys.argv[2:]:
 v=json.loads(Path(p).read_text());assert v['ok'] and v['sourceCommit']==r['sourceCommit'] and v['distributionId']==r['platforms']['darwin-arm64']['distributionId'] and v['installation']['channel']=='homebrew'
PY
  test "$(cat "$PI_CODING_AGENT_DIR/sessions/preserve.txt")" = 'retained session fixture'
  test "$(cat "$PI_CODING_AGENT_DIR/settings.json")" = '{}'
}
brew upgrade --formula omp-acceptance/local/only-my-pi
check_identity upgrade
brew test omp-acceptance/local/only-my-pi
brew uninstall --formula omp-acceptance/local/only-my-pi
test ! -e "$(brew --prefix)/bin/omp"
test "$(cat "$PI_CODING_AGENT_DIR/sessions/preserve.txt")" = 'retained session fixture'
brew install --formula omp-acceptance/local/only-my-pi
check_identity reinstall
brew uninstall --formula omp-acceptance/local/only-my-pi
python3 - "$candidate" "$evidence" <<'PY'
import sys,json,hashlib
from pathlib import Path
c,e=map(Path,sys.argv[1:]);r=json.loads((c/'build-receipt.json').read_text())
report={'status':'HOMEBREW_CANDIDATE_LIFECYCLE_PASS','sourceCommit':r['sourceCommit'],'distributionId':r['platforms']['darwin-arm64']['distributionId'],'buildReceiptSha256':'sha256:'+hashlib.sha256((c/'build-receipt.json').read_bytes()).hexdigest(),'previousVersion':'0.4.0-preview.1','productUpgrade':True,'formulaTest':True,'uninstall':True,'reinstall':True,'userDataPreserved':True,'publicTapInstall':False}
(e/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
PY
