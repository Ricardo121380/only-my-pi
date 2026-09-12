import { DISTRIBUTION_VERSION } from "./runtime.mjs";

/** The tap consumes the already-built npm archives, never rebuilds the core. */
export function homebrewFormula(receipt, { localAssetDirectory } = {}) {
  if (receipt?.version !== DISTRIBUTION_VERSION || !/^[a-f0-9]{40}$/u.test(receipt.sourceCommit ?? "")
    || !/^sha256:[a-f0-9]{64}$/u.test(receipt.distributionId ?? "") || !Array.isArray(receipt.artifacts))
    throw new Error("Homebrew requires an identified macOS Preview build");
  const select = (name) => {
    const artifact = receipt.artifacts.find((entry) => entry.name === name);
    if (!artifact || artifact.version !== receipt.version || artifact.filename !== `${name}-${receipt.version}.tgz`
      || !/^sha256:[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error(`invalid Homebrew artifact: ${name}`);
    return artifact;
  };
  const cli = select("only-my-pi");
  const runtime = select("only-my-pi-runtime-darwin-arm64");
  let base = `https://github.com/Ricardo121380/only-my-pi/releases/download/v${receipt.version}`;
  if (localAssetDirectory) {
    if (!/^\/[A-Za-z0-9_./-]+$/u.test(localAssetDirectory) || localAssetDirectory.split("/").includes(".."))
      throw new Error("local Homebrew fixture directory must be an absolute simple path");
    base = `file://${localAssetDirectory}`;
  }
  return `# Generated from ${receipt.sourceCommit}; core identity ${receipt.distributionId}
class OnlyMyPi < Formula
  desc "Guarded terminal coding agent built on Pi (Public Preview)"
  homepage "https://github.com/Ricardo121380/only-my-pi"
  url "${base}/${cli.filename}"
  version "${receipt.version}"
  sha256 "${cli.sha256.slice(7)}"
  license "MIT"

  depends_on arch: :arm64
  depends_on macos: :sonoma
  depends_on "node@24"
  depends_on "git"
  skip_clean :all

  resource "only-my-pi-runtime-darwin-arm64" do
    url "${base}/${runtime.filename}"
    sha256 "${runtime.sha256.slice(7)}"
  end

  def install
    cli = libexec/"lib/node_modules/only-my-pi"
    cli.install Dir["*"]
    # Preserve the verified archive through Homebrew's Mach-O relocation pass.
    libexec.install resource("only-my-pi-runtime-darwin-arm64").cached_download => "runtime.tgz"
    node = Formula["node@24"].opt_bin/"node"
    (cli/"omp").write <<~SH
      #!/bin/sh
      export PATH="#{Formula["node@24"].opt_bin}:#{Formula["git"].opt_bin}:$PATH"
      exec "#{node}" "#{cli}/loader.mjs" "$@"
    SH
    chmod 0755, cli/"omp"
    bin.install_symlink cli/"omp"
  end

  def post_install
    runtime = libexec/"lib/node_modules/only-my-pi-runtime-darwin-arm64"
    unless runtime.exist?
      runtime.mkpath
      system "/usr/bin/tar", "-xzf", libexec/"runtime.tgz", "-C", runtime, "--strip-components", "1"
      File.write(runtime/"distribution-installation.json", <<~JSON)
        {"formatVersion":1,"channel":"homebrew","version":"${receipt.version}"}
      JSON
    end
    system Formula["node@24"].opt_bin/"node", libexec/"lib/node_modules/only-my-pi/loader.mjs", "--verify-install"
  end

  def caveats
    <<~EOS
      This is OMP ${receipt.version}, a Public Preview.
      Run omp; use omp admin pi for model authentication.
      Existing Pi configuration and sessions are preserved on uninstall.
    EOS
  end

  test do
    assert_match "only-my-pi ${receipt.version}", shell_output("#{bin}/omp --version")
    assert_match '"channel": "homebrew"', shell_output("#{bin}/omp admin version --json")
    assert_match '"ok": true', shell_output("#{bin}/omp admin doctor --json")
    assert_match "0.84.3", shell_output("#{bin}/omp admin pi --version")
    refute_path_exists testpath/".pi"
  end
end
`;
}
