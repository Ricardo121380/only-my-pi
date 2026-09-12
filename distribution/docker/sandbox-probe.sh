#!/bin/sh
set -eu
probe_root=$(mktemp -d)
trap 'rm -rf "$probe_root"' EXIT HUP INT TERM
mkdir "$probe_root/allowed"
printf 'private probe sentinel\n' > "$probe_root/secret"
parent_net=$(readlink /proc/self/ns/net)
parent_pid=$(readlink /proc/self/ns/pid)
bwrap --new-session --die-with-parent --unshare-user --unshare-pid --unshare-net \
  --ro-bind / / --dev /dev --proc /proc \
  --bind "$probe_root/allowed" /workspace --tmpfs "$probe_root" \
  -- /bin/sh -eu -c '
    test "$(readlink /proc/self/ns/net)" != "$1"
    test "$(readlink /proc/self/ns/pid)" != "$2"
    test ! -f "$3/secret"
    if (printf forbidden > /etc/omp-outside-probe) 2>/dev/null; then exit 1; fi
    printf allowed > /workspace/result
  ' probe "$parent_net" "$parent_pid" "$probe_root"
test "$(cat "$probe_root/allowed/result")" = allowed
printf '{"status":"PASS","filesystem":true,"networkNamespace":true,"pidNamespace":true,"freshProc":true}\n'
