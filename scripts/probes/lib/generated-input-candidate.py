"""Replay the three outstanding #22 objects from a frozen private material set.

The supplement contains the complete deliverable set. Raw configure/TeX/Git
workspaces, including config.status and every diagnostic, remain in the separate
execution directory and are inventoried by the public CLI receipt.
"""
import difflib
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def write_json(file, value):
    file.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n")


def identity(file):
    return {"bytes": file.stat().st_size, "sha256": digest(file.read_bytes()),
            "mode": "100755" if file.stat().st_mode & 0o111 else "100644"}


def run(name, command, cwd, environment, execution):
    result = subprocess.run(command, cwd=cwd, env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    (execution / (name + ".stdout")).write_bytes(result.stdout)
    (execution / (name + ".stderr")).write_bytes(result.stderr)
    write_json(execution / (name + ".json"), {
        "command": command, "cwd": str(cwd), "environment": environment,
        "exit": result.returncode, "stdout": digest(result.stdout), "stderr": digest(result.stderr)})
    if result.returncode:
        raise RuntimeError("GENERATED_CANDIDATE_COMMAND_FAILED:" + name)
    return result.stdout


def verify_macro_sources(materials, execution, environment):
    rows = json.loads((materials / "config/macro-bindings.json").read_text())
    families = {}
    for row in rows:
        current = materials / row["material"]
        assert identity(current) == row["identity"], row["path"]
        for item in row["sourceMaterials"]:
            assert (materials / item).is_file(), item
        if row["binding"] == "EXACT_FIXED_MEMBER":
            assert current.read_bytes() == (materials / row["sourceMaterials"][0]).read_bytes()
        elif row["binding"] == "RECONSTRUCTED_FROM_FIXED_BASE_AND_REVIEWED_PATCH":
            target = execution / ("reconstruct-" + row["path"].replace("/", "-"))
            shutil.copyfile(materials / row["sourceMaterials"][0], target)
            run("patch-" + row["path"].replace("/", "-"),
                ["/usr/bin/patch", "--fuzz=0", str(target), str(materials / row["patch"])],
                execution, environment, execution)
            assert target.read_bytes() == current.read_bytes(), row["path"]
        else:
            assert row["binding"] == "FIXED_GENERATOR_AND_PACKAGE_INPUTS_HISTORY_UNVERIFIED"
            assert row["generatorArchive"] and row["packageInputs"]
            assert (materials / row["generatorArchive"]).is_file()
        assert (materials / row["completeStatement"]).read_bytes() == current.read_bytes()
        assert row["historicalInvocation"] == "UNVERIFIED"
        families[row["family"]] = families.get(row["family"], 0) + 1
    assert len(rows) == len({row["path"] for row in rows}) == 111
    assert len(families) == 10
    return rows, families


def reuse_headers(materials):
    recipe = json.loads((materials / "legacy/supplement/recipe.json").read_text())
    replays = []
    for row in recipe["remainingInputs"]:
        if not row.get("replayMaterials"):
            continue
        current = materials / "sources" / row["path"]
        assert identity(current) == row["candidate"]
        assert len(row["replayMaterials"]) == 2
        for item, receipt in zip(row["replayMaterials"], row["replay"]):
            assert (materials / "legacy/supplement/origins" / item).read_bytes() == current.read_bytes()
            assert receipt["exit"] == 0 and receipt["network"] == "DENIED"
            assert receipt["sha256"] == identity(current)["sha256"]
        for item in row["inputMaterials"]:
            assert (materials / "sources" / item).read_bytes() == (
                materials / "legacy/supplement" /
                ("prior/source/" + item if (materials / "legacy/supplement/prior/source" / item).exists()
                 else "source/" + item)).read_bytes()
        replays.append({"path": row["path"], "identity": identity(current),
                        "scope": "REUSED_TWO_OFFLINE_AUTOHEADER_REPLAYS_ONLY",
                        "historicalInvocation": "UNVERIFIED"})
    assert len(replays) == 5
    # Preserve the three static correspondences without converting them into
    # evidence of historical dates or compiler/config.status execution.
    assert (materials / "sources/ffi/doc/stamp-vti").read_bytes() == (
        materials / "sources/ffi/doc/version.texi").read_bytes()
    source = materials / "sources/exif"
    spec = (source / "libexif.spec.in").read_text().replace("Name: @PACKAGE@", "Name: libexif").replace(
        "Version: @VERSION@", "Version: 0.6.26")
    assert (source / "libexif.spec").read_text() == spec
    marker = 'AX_CHECK_DEFINED_TYPE(uint8_t,\nstdint.h,\n[\ncat > "$1" <<EOF\n'
    stdint = (source / "m4m/stdint.m4").read_text().split(marker)[1].split("EOF],")[0]
    assert (source / "libexif/_stdint.h").read_text() == stdint
    return replays


def generate_changelog(materials, generated, execution, environment, config):
    history = execution / "history"
    run("git-clone", ["/usr/bin/git", "clone", "--bare", "--no-hardlinks",
        str(materials / "archives/libffi-history.bundle"), str(history)], execution, environment, execution)
    git = ["/usr/bin/git", "--git-dir=" + str(history)]
    head = config["libffiCommit"]
    count = run("git-count", git + ["rev-list", "--count", head], execution, environment, execution)
    assert count.strip() == b"2082"
    graph = run("git-graph", git + ["rev-list", "--parents", head], execution, environment, execution)
    assert digest(graph) == config["gitGraphSha256"]
    # Default abbreviation depends on the total object database, including
    # unrelated refs. Pin it for this self-contained reachable-history bundle.
    log = run("git-log", git + ["log", "--no-decorate", "--abbrev=8", head], execution, environment, execution)
    (generated / "ChangeLog").write_bytes(log)
    assert log == (materials / "sources/ffi/ChangeLog").read_bytes()
    return {"commit": head, "range": "ALL_2082_COMMITS_REACHABLE_FROM_FIXED_HEAD",
            "graphSha256": digest(graph), "sameAsOld": True, "historicalInvocation": "UNVERIFIED"}


def tex_environment(materials, work, environment):
    texmf = str(materials / "tools/texlive/texmf-dist")
    return {**environment, "TEXMF": texmf, "TEXMFCNF": texmf + "/web2c",
            "TEXMFVAR": str(work), "TEXMFCONFIG": str(work),
            "TEXINPUTS": ".:" + texmf + "/tex//", "TFMFONTS": texmf + "/fonts/tfm//",
            "T1FONTS": texmf + "/fonts/type1//", "TEXFONTMAPS": ".:" + texmf + "/fonts/map//",
            "TEXFORMATS": ".", "MKTEXPK": "0", "MKTEXTFM": "0", "MKTEXFMT": "0"}


def generate_pdf(materials, generated, execution, environment):
    work = execution / "tex"
    work.mkdir()
    for name in ["libffi.texi", "version.texi", "texinfo.tex"]:
        shutil.copyfile(materials / "sources/ffi/doc" / name, work / name)
    for name in ["pdftex.map", "reproducible.tex"]:
        shutil.copyfile(materials / "config" / name, work / name)
    env = tex_environment(materials, work, environment)
    pdftex = str(materials / "tools/texlive/bin/universal-darwin/pdftex")
    run("tex-format", [pdftex, "-ini", "-etex", "-no-shell-escape", "-recorder",
        "-interaction=nonstopmode", "-halt-on-error", "-jobname=pdftex",
        r"\pdfoutput=1 \input plain \dump"], work, env, execution)
    shutil.copyfile(work / "pdftex.fls", execution / "format.fls")
    previous = None
    for number in range(1, 5):
        run("tex-pass-" + str(number), [pdftex, "-fmt=./pdftex.fmt", "-no-shell-escape",
            "-interaction=nonstopmode", "-halt-on-error", "-recorder", "-jobname=libffi",
            "reproducible.tex"], work, env, execution)
        shutil.copyfile(work / "libffi.fls", execution / ("tex-pass-" + str(number) + ".fls"))
        current = (work / "libffi.pdf").read_bytes()
        if number == 4:
            assert current == previous, "PDF_DID_NOT_CONVERGE"
        previous = current
        indexes = [str(p.name) for p in sorted(work.glob("libffi.??"))
                   if p.suffix in [".cp", ".fn", ".vr", ".ky", ".pg", ".tp"]]
        run("texindex-" + str(number), ["/bin/sh", str(materials / "tools/texinfo/texindex/texindex.in"),
            *indexes], work, {**env, "TEXINDEX_AWK": "/usr/bin/awk",
            "TEXINDEX_SCRIPT": str(materials / "tools/texinfo/texindex/texindex.awk")}, execution)
    inputs = set()
    for fls in sorted(execution.glob("*.fls")):
        for line in fls.read_text().splitlines():
            if not line.startswith("INPUT "):
                continue
            file = pathlib.Path(line[6:])
            if not file.is_absolute():
                file = work / file
            file = file.resolve()
            if file == pathlib.Path("/dev/null"):
                continue
            assert materials in file.parents or execution in file.parents, "UNFROZEN_TEX_INPUT:" + str(file)
            inputs.add(("materials/" + str(file.relative_to(materials))) if materials in file.parents
                       else "execution/" + str(file.relative_to(execution)))
    (generated / "libffi.pdf").write_bytes(current)
    return {"engine": "pdfTeX-1.40.29-TeX-Live-2026", "texinfoMacro": "2021-04-25.21",
            "format": "NEW_PLAIN_FORMAT_FROM_FIXED_INPUTS", "passes": 4,
            "texInputs": sorted(inputs), "shellEscape": "DISABLED",
            "historicalEngine": "pdfTeX-1.40.25_METADATA_ONLY_UNVERIFIED",
            "sourceContent": "UNCHANGED_LIBFFI_3_8_0_TEXINFO_AND_COPYING_NOTICE"}


def defines(file):
    return {match.group(1): match.group(2) for match in
            re.finditer(r"^#define\s+(\w+)(.*)$", file.read_text(), re.M)}


def generate_expat(materials, generated, execution, environment, config):
    source = execution / "expat-source"
    shutil.copytree(materials / "sources/expat/expat", source)
    work = execution / "expat-build"
    work.mkdir()
    env = {**environment, **config["compilerEnvironment"], "CONFIG_SITE": "/dev/null",
           "CLANG_MODULE_CACHE_PATH": str(execution / "clang-cache")}
    run("expat-configure", ["/bin/sh", "../expat-source/configure", *config["configureArguments"]],
        work, env, execution)
    run("expat-config-status", ["/bin/sh", "./config.status", "expat_config.h"], work, env, execution)
    target = generated / "expat_config.h"
    shutil.copyfile(work / "expat_config.h", target)
    old = materials / "sources/expat/expat/expat_config.h"
    before, after = defines(old), defines(target)
    differences = [{"name": name, "before": before.get(name), "after": after.get(name)}
                   for name in sorted(set(before) | set(after)) if before.get(name) != after.get(name)]
    (work / "header-diff.patch").write_text("".join(difflib.unified_diff(
        old.read_text().splitlines(True), target.read_text().splitlines(True),
        fromfile="old-expat_config.h", tofile="new-expat_config.h")))
    probe = work / "material-structure.c"
    probe.write_text('#include "expat_config.h"\n#include "expat.h"\n'
                     '_Static_assert(XML_MAJOR_VERSION == 2, "Expat major drift");\n'
                     '_Static_assert(BYTEORDER == 1234, "target endian drift");\n'
                     'XML_Parser parser;\n')
    run("expat-header-compile", [env["CC"], "-fsyntax-only", "-std=c11", "-I.",
        "-I../expat-source/lib", "material-structure.c"], work, env, execution)
    return {"platform": "arm64-apple-darwin27", "configureArguments": config["configureArguments"],
            "compilerEnvironment": config["compilerEnvironment"], "differences": differences,
            "headerStructureCompile": "PASS", "nativeApplicationBuild": "NOT_RUN",
            "configStatus": "ACTUALLY_EXECUTED_RETAINED_IN_EXECUTION_RECEIPT",
            "historicalPlatformAndInvocation": "UNVERIFIED"}


def main():
    materials, output, execution = map(lambda value: pathlib.Path(value).resolve(), sys.argv[1:])
    config = json.loads((materials / "config/processing.json").read_text())
    environment = dict(os.environ)
    generated = output / "generated"
    generated.mkdir()
    macros, families = verify_macro_sources(materials, execution, environment)
    headers = reuse_headers(materials)
    changelog = generate_changelog(materials, generated, execution, environment, config)
    pdf = generate_pdf(materials, generated, execution, environment)
    expat = generate_expat(materials, generated, execution, environment, config)
    objects = [{"path": str(p.relative_to(output)), **identity(p)} for p in sorted(generated.iterdir())]
    obligations = json.loads((materials / "config/current-obligations.json").read_text())
    assert len(obligations["macroObjects"]) == 111
    write_json(output / "generation.json", {
        "formatVersion": 1, "purpose": "GENERATED_INPUT_MATERIAL_CANDIDATE_ONLY",
        "generatedObjects": 3, "reusedAutoheaderTemplates": 5, "macroFiles": len(macros),
        "families": families, "objects": objects, "autoheaderEvidence": headers,
        "ChangeLog": changelog, "PDF": pdf, "Expat": expat,
        "staticCorrespondences": "RETAINED_THREE_STATIC_CORRESPONDENCES_ONLY",
        "currentConditions": "SATISFIED_LOCAL_PRIVATE_OPERATIONS",
        "historicalInvocations": "UNVERIFIED", "nativeBuild": "NOT_RUN",
        "licensingClosure": "INCOMPLETE", "Full": "NOT_RUN", "U2": "BLOCKED"})
    write_json(output / "current-obligations.json", obligations)


if __name__ == "__main__":
    main()
