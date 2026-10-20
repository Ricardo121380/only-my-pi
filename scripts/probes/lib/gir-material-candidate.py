"""Replay fixed supplier GIR processing and audit every retained document node.

Invoked only by the manifest-pinned Node CLI. No network acquisition occurs here.
Archive members are read, never generally extracted or executed.
"""
import collections
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import xml.etree.ElementTree as ET

CORE = "{http://www.gtk.org/introspection/core/1.0}"
CTYPE = "{http://www.gtk.org/introspection/c/1.0}"
DOC = "{http://www.gtk.org/introspection/doc/1.0}"
DOC_TAGS = {CORE + "doc", CORE + "doc-deprecated", CORE + "doc-version"}


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def normalize(text):
    return re.sub(r"\s+", " ", text or "").strip()


def clean_source(text):
    return normalize(re.sub(r"^\s*\* ?", "", text, flags=re.M))


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("x", encoding="utf8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def safe_member(name):
    require(not name.startswith("/") and ".." not in PurePosixPath(name).parts and "\\" not in name, "GIR_CANDIDATE_ARCHIVE_PATH_UNSAFE")


def read_member(archive, member, bsdtar=False):
    safe_member(member)
    if bsdtar:
        result = subprocess.run(["/usr/bin/tar", "-xOf", str(archive), member], capture_output=True, timeout=60)
        require(result.returncode == 0, "GIR_CANDIDATE_ARCHIVE_MEMBER_MISSING:" + json.dumps({"archive": str(archive), "member": member, "exitCode": result.returncode, "stderr": result.stderr.decode(errors="replace")}))
        data = result.stdout
    else:
        with tarfile.open(archive) as stream:
            item = stream.getmember(member)
            require(item.isfile() and item.size < 32 * 1024 * 1024, "GIR_CANDIDATE_ARCHIVE_MEMBER_UNSAFE")
            data = stream.extractfile(item).read()
    require(len(data) < 32 * 1024 * 1024, "GIR_CANDIDATE_ARCHIVE_MEMBER_UNSAFE")
    return data


def xml_nodes(root):
    """Stable within-file owner paths; keep all attributes and text for comparison."""
    result = {}

    def walk(node, key):
        require(key not in result, "GIR_CANDIDATE_XML_OWNER_COLLISION")
        result[key] = node
        counts = collections.Counter()
        for child in node:
            identifier = child.attrib.get("name", child.attrib.get(CTYPE + "identifier"))
            base = child.tag + ("=" + identifier if identifier is not None else "")
            index = counts[base]
            counts[base] += 1
            walk(child, key + "/" + base + "[" + str(index) + "]")

    walk(root, root.tag)
    return result


def sources(materials, config, output):
    projects = {}
    for project in config["sourceProjects"]:
        files = {}
        with tarfile.open(materials / project["archive"]) as archive:
            for member in archive:
                if not member.isfile():
                    continue
                name = member.name.split("/", 1)[-1]
                license_file = bool(re.search(r"(^|/)(COPYING[^/]*|LICENSE[^/]*|LICENCE[^/]*|COPYRIGHT[^/]*|License[^/]*)$", name))
                source_file = name.endswith((".c", ".h", ".cc", ".hh", ".h.in", ".c.in", ".py", ".py.in", ".xml", ".gir", ".gir.in"))
                if not license_file and not source_file:
                    continue
                safe_member(name)
                data = archive.extractfile(member).read()
                record = {"project": project["id"], "archive": project["archive"], "member": member.name, "sha256": sha(data), "bytes": len(data)}
                if source_file:
                    files[name] = {"record": record, "data": data, "clean": clean_source(data.decode("utf8", errors="surrogateescape"))}
                if license_file:
                    target = output / "notices/original-texts" / project["id"] / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
        projects[project["id"]] = files
    return projects


def generate_dbus_correspondence(projects, output, commands):
    """A fresh template execution for the 14 GTK3 generated-document nodes.

    This is source correspondence for the new candidate, not a claim about the
    historical package's gdbus-codegen executable or generated C bytes.
    """
    tool = output / "derived/codegen"
    tool.mkdir(parents=True)
    for name, source in projects["glib"].items():
        if name.startswith("gio/gdbus-2.0/codegen/") and name.endswith(".py"):
            (tool / Path(name).name).write_bytes(source["data"])
    config_source = projects["glib"]["gio/gdbus-2.0/codegen/config.py.in"]["data"].decode()
    config_source = config_source.replace("@VERSION@", "2.87.0").replace("@MAJOR_VERSION@", "2").replace("@MINOR_VERSION@", "87")
    (tool / "config.py").write_text(config_source, encoding="utf8")
    work = output / "derived/gtk3"
    work.mkdir()
    (work / "gtkdbusinterfaces.xml").write_bytes(projects["gtk3"]["gtk/gtkdbusinterfaces.xml"]["data"])
    command = ["/usr/bin/python3", "-m", "codegen.codegen_main", "--interface-prefix", "org.Gtk.", "--c-namespace", "_Gtk", "--generate-c-code", "gtkdbusgenerated", "gtkdbusinterfaces.xml"]
    result = subprocess.run(command, cwd=work, env={**os.environ, "PYTHONPATH": str(tool.parent)}, capture_output=True, text=True, timeout=60)
    commands.append({"command": command, "cwd": str(work), "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
    require(result.returncode == 0, "GIR_CANDIDATE_DOC_GENERATOR_FAILED")
    for extension in ["c", "h"]:
        file = work / ("gtkdbusgenerated." + extension)
        data = file.read_bytes()
        projects["gtk3"]["gtk/gtkdbusgenerated." + extension] = {"record": {"project": "gtk3", "generated": "derived/gtk3/" + file.name, "sha256": sha(data), "bytes": len(data), "recipe": "GTK 3.24.50 gtk/meson.build:756-758; fixed GLib 2.87.0 codegen and original interface XML"}, "data": data, "clean": clean_source(data.decode())}


def documentation(materials, config, projects, raw_trees, candidate_trees, output):
    source_table, source_ids, rows, removed = [], {}, [], []
    exceptions = {item["gir"] + ":" + item["docSha256"]: item for item in config["reviewedDocProjections"]}
    correspondence_counts = collections.Counter()
    referenced_sources = set()
    for supply in config["suppliers"]:
        name, project = supply["gir"], supply["sourceProject"]
        files = projects[project]
        raw_nodes, new_nodes = xml_nodes(raw_trees[name]), xml_nodes(candidate_trees[name])
        parents = {child: parent for parent in raw_trees[name].iter() for child in parent}
        for key, node in raw_nodes.items():
            if node.tag not in DOC_TAGS:
                continue
            text = normalize(node.text)
            text_hash = sha((node.text or "").encode())
            references = []
            owner = node
            while owner in parents:
                owner = parents[owner]
                for ref in [owner.find(CORE + "doc"), owner.find(CORE + "source-position")]:
                    if ref is not None and ref.attrib.get("filename"):
                        filename = ref.attrib["filename"].removeprefix("../").removeprefix("./")
                        references.extend([filename, filename + ".in"])
            if node.attrib.get("filename"):
                filename = node.attrib["filename"].removeprefix("../").removeprefix("./")
                references = [filename, filename + ".in"] + references
            matches = [(member, files[member]) for member in dict.fromkeys(references) if member in files and text in files[member]["clean"]]
            relation = "DECLARED_OR_OWNER_SOURCE_EXACT_PROSE"
            if not matches:
                matches = [(member, source) for member, source in files.items() if text and text in source["clean"]]
                relation = "PACKAGE_SOURCE_EXACT_PROSE_ALL_MATCHES_RETAINED"
            if not matches:
                projection = exceptions.get(name + ":" + text_hash)
                require(projection is not None, "GIR_CANDIDATE_DOCUMENT_SOURCE_UNRESOLVED:" + name + ":" + key)
                source = files[projection["member"]]
                require(source["record"]["sha256"] == projection["sourceSha256"], "GIR_CANDIDATE_DOC_PROJECTION_DRIFT")
                lines = source["data"].decode().splitlines()
                projected = " ".join(clean_source("\n".join(lines[start - 1:end])) for start, end in projection["segments"])
                require(normalize(projected) == text, "GIR_CANDIDATE_DOC_PROJECTION_DRIFT")
                matches = [(projection["member"], source)]
                relation = projection["relation"]
            ids = []
            for member, source in matches:
                source_key = project + ":" + member
                if source_key not in source_ids:
                    source_ids[source_key] = len(source_table)
                    source_table.append({**source["record"], "sourcePath": member, "copyrightAndTerms": "Complete original source member, its header and the package's original notice texts; see current-obligations.json", "noticeRules": config["projectNoticeRules"][project]})
                ids.append(source_ids[source_key])
                referenced_sources.add((project, member))
            row = {"gir": name, "owner": key, "kind": node.tag.split("}")[-1], "docSha256": text_hash, "rawPosition": dict(node.attrib), "sourceIds": ids, "correspondence": relation}
            if key not in new_nodes:
                removed.append(row)
                continue
            require(new_nodes[key].tag == node.tag and new_nodes[key].text == node.text, "GIR_CANDIDATE_DOCUMENT_CONTENT_DRIFT")
            rows.append(row)
            correspondence_counts[relation] += 1
        for key, node in new_nodes.items():
            if node.tag in DOC_TAGS:
                require(key in raw_nodes, "GIR_CANDIDATE_UNBOUND_DOCUMENT")
    for project, member in sorted(referenced_sources):
        target = output / "notices/source-members" / project / member
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(projects[project][member]["data"])
    write_json(output / "documentation-ledger.json", {"status": "PASS_SOURCE_TEXT_CORRESPONDENCE_ONLY", "quotationAndCurrentConditions": "PARTIAL", "documents": len(rows), "sourceMembers": source_table, "rows": rows, "rawNodesRemovedByFixedRecipe": removed, "correspondenceCounts": dict(correspondence_counts), "externalTextReview": config["externalTextReview"], "historicalSupplierBuildsAndManualEdition": "UNVERIFIED", "licensingClosure": "INCOMPLETE"})


def compatibility(config, old, candidate_trees, output):
    result = []
    for pin in config["expectedOutputs"]:
        name = pin["path"]
        before, after = (old / name).read_bytes(), (output / "candidate" / name).read_bytes()
        require(sha(after) == pin["sha256"] and len(after) == pin["bytes"], "GIR_CANDIDATE_UNREVIEWED_OUTPUT_DRIFT")
        item = {"path": name, "oldSha256": sha(before), "newSha256": sha(after), "oldBytes": len(before), "newBytes": len(after), "sameBytes": before == after, "explanation": config["differenceExplanations"].get(name, "Full bytes and execute-bit mode unchanged")}
        if name.endswith(".gir"):
            a, b = xml_nodes(ET.fromstring(before)), xml_nodes(candidate_trees[name])
            removed = sorted(set(a) - set(b))
            added = sorted(set(b) - set(a))
            changed = []
            for key in sorted(set(a) & set(b)):
                require(a[key].tag == b[key].tag and normalize(a[key].text) == normalize(b[key].text), "GIR_CANDIDATE_EXISTING_DOCUMENT_OR_NODE_CHANGED")
                if a[key].attrib != b[key].attrib:
                    changed.append({"owner": key, "before": a[key].attrib, "after": b[key].attrib})
            require(not removed, "GIR_CANDIDATE_EXISTING_INTERFACE_REMOVED")
            observed = {"added": added, "changedAttributes": changed}
            require(observed == config["reviewedXmlDifferences"].get(name, {"added": [], "changedAttributes": []}), "GIR_CANDIDATE_UNKNOWN_INTERFACE_CONVERSION")
            item["xmlDifferences"] = observed
            item["oldDocumentNodes"] = sum(node.tag in DOC_TAGS for node in a.values())
            item["newDocumentNodes"] = sum(node.tag in DOC_TAGS for node in b.values())
            item["namespace"] = candidate_trees[name].find(CORE + "namespace").attrib
        result.append(item)
    write_json(output / "compatibility.json", {"status": "PASS_MATERIAL_STRUCTURE_EXISTING_SIGNATURES_AND_DOCUMENT_COVERAGE", "rows": result, "files": len(result), "girFiles": len(candidate_trees), "sameBytes": sum(row["sameBytes"] for row in result), "runtimeCompatibility": "NOT_RUN_G2-00-04", "configurationObservations": config["configurationObservations"]})


def main():
    os.umask(0o022)
    materials = Path.cwd()
    output = (materials / sys.argv[1]).resolve()
    config = json.loads((materials / "config/processing.json").read_text())
    commands = []
    old = materials / "history/origins/snapshot"
    candidate, raw = output / "candidate", output / "raw-gir"
    candidate.mkdir()
    raw.mkdir()
    expected = {item["path"] for item in config["expectedOutputs"]}
    supplies = config["suppliers"]
    require(len(supplies) == 40 and len({item["gir"] for item in supplies}) == 40, "GIR_CANDIDATE_SUPPLY_SET_DRIFT")
    require({item["gir"] for item in supplies} == {name for name in expected if name.endswith(".gir")}, "GIR_CANDIDATE_SUPPLY_SET_DRIFT")
    for name in sorted(expected):
        if not name.endswith(".gir"):
            dest = candidate / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(old / name, dest)
    raw_trees = {}
    for supply in supplies:
        data = read_member(materials / supply["archive"], supply["member"], supply.get("bsdtar", False))
        require(sha(data) == supply["rawSha256"] and len(data) == supply["rawBytes"], "GIR_CANDIDATE_RAW_SUPPLIER_DRIFT")
        (raw / supply["gir"]).write_bytes(data)
        (candidate / supply["gir"]).write_bytes(data)
        raw_trees[supply["gir"]] = ET.fromstring(data)
    version = subprocess.run(["xmlstarlet", "--version"], capture_output=True, text=True, timeout=10)
    commands.append({"command": ["xmlstarlet", "--version"], "exitCode": version.returncode, "stdout": version.stdout, "stderr": version.stderr})
    require(version.returncode == 0 and version.stdout == config["xmlstarletVersionOutput"], "GIR_CANDIDATE_TOOL_VERSION_DRIFT")
    for script in ["reformat.sh", "fix.sh"]:
        command = ["/bin/bash", script]
        result = subprocess.run(command, cwd=candidate, capture_output=True, text=True, timeout=120)
        commands.append({"command": command, "cwd": str(candidate), "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
        require(result.returncode == 0, "GIR_CANDIDATE_PROCESSING_FAILED")
    require({file.relative_to(candidate).as_posix() for file in candidate.rglob("*") if file.is_file()} == expected, "GIR_CANDIDATE_OUTPUT_SET_DRIFT")
    candidate_trees = {item["gir"]: ET.parse(candidate / item["gir"]).getroot() for item in supplies}
    compatibility(config, old, candidate_trees, output)
    projects = sources(materials, config, output)
    generate_dbus_correspondence(projects, output, commands)
    documentation(materials, config, projects, raw_trees, candidate_trees, output)
    write_json(output / "generation-bindings.json", {"purpose": "GIR_MATERIAL_CANDIDATE_ONLY", "suppliers": supplies, "processing": ["candidate/reformat.sh", "candidate/fix.sh"], "toolVersion": config["xmlstarletVersionOutput"], "rawInputsRetained": "raw-gir/", "oldCompleteScopeRetained": "materials/history/origins/snapshot/", "historicalSupplierIdentity": "UNVERIFIED", "nativeBuild": "NOT_RUN", "licensingClosure": "INCOMPLETE", "Full": "NOT_RUN"})
    obligations = json.loads((materials / "config/current-obligations.json").read_text())
    obligations["objects"] = [{"path": pin["path"], "sha256": pin["sha256"], "mode": pin["mode"], "purpose": "Local material investigation and deterministic processing; candidate admission BLOCKED", "currentConditions": "PARTIAL; retained original notices do not establish all external quotation rights", "nextGates": ["#23", "G2-00-04", "G2-00-05", "G2-00-06"]} for pin in config["expectedOutputs"]]
    write_json(output / "current-obligations.json", obligations)
    print(json.dumps({"status": "PASS_LOCAL_GIR_GENERATION_AND_DOCUMENT_CORRESPONDENCE", "commands": commands, "files": 53, "girFiles": 40, "nativeBuild": "NOT_RUN", "licensingClosure": "INCOMPLETE", "Full": "NOT_RUN"}))


if __name__ == "__main__":
    main()
