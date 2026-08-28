import fs from "node:fs/promises";
import path from "node:path";

import {
  computeOwnedGraphDigest,
  generationKeyFromDigest,
  planOwnedGraph,
} from "../bootstrap/graph-plan.mjs";
import { bindExistingPackages } from "../bootstrap/package-bindings.mjs";
import { M10_EXACT_PACKAGE_TARGET } from "./contract.mjs";

async function readJson(root, relative) {
  const target = path.join(root, ...relative.split("/"));
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError(`candidate target input must be a real file: ${relative}`);
  const real = await fs.realpath(target);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new TypeError(`candidate target input escapes artifact root: ${relative}`);
  return JSON.parse(await fs.readFile(target, "utf8"));
}

function candidatePackageInventory(stable, contract) {
  const candidates = new Map(contract.candidate.packages.filter((entry) => entry.id !== "pi").map((entry) => [entry.id, entry]));
  const packages = stable.packages.map((entry) => {
    const candidate = candidates.get(entry.id);
    if (!candidate) return structuredClone(entry);
    return {
      ...structuredClone(entry),
      spec: `npm:${candidate.sourceSpec}`,
      review: "m9-candidate-audited",
      audit: {
        date: "2026-08-28",
        integrity: candidate.integrity,
        lifecycle: {
          execution: "disabled",
          scripts: candidate.installLifecycleScripts,
        },
      },
    };
  });
  return {
    ...structuredClone(stable),
    runtime: { ...stable.runtime, pi: contract.candidate.piVersion },
    packages,
  };
}

function assertExactContract(contract) {
  const candidate = contract?.candidate;
  const decision = contract?.decision;
  const decisionValid = decision?.state === "HOLD"
    ? decision.defaultPiVersion === "0.84.1" && decision.defaultSubagentsVersion === "0.45.2"
    : decision?.state === "PROMOTE"
      && decision.reasonCode === "M10_REAL_ROOT_AND_LIVE_ACCEPTANCE_PASSED"
      && decision.defaultPiVersion === "0.84.3"
      && decision.defaultSubagentsVersion === "0.57.0";
  if (candidate?.piVersion !== "0.84.3" || candidate?.subagentsVersion !== "0.57.0" || !decisionValid) {
    throw Object.assign(new Error("candidate target requires the exact audited M9 tuple and a governed M10 decision"), { code: "CANDIDATE_CONTRACT_DRIFT" });
  }
  const expected = new Map(M10_EXACT_PACKAGE_TARGET.filter((entry) => entry.action === "upgrade").map((entry) => [entry.id, entry]));
  const actual = candidate.packages.filter((entry) => entry.id !== "pi");
  if (actual.length !== expected.size || actual.some((entry) => {
    const wanted = expected.get(entry.id);
    return !wanted || entry.version !== wanted.toVersion || entry.integrity !== wanted.toIntegrity || entry.sourceSpec !== `${wanted.name}@${wanted.toVersion}`;
  })) throw Object.assign(new Error("candidate packages differ from the audited M9 exact target"), { code: "CANDIDATE_PACKAGE_DRIFT" });
}

export async function buildCandidateGenerationPlan({ rootDir, profileId = "daily" } = {}) {
  if (profileId !== "daily") throw new TypeError("M10 candidate target is available only for the daily profile");
  const artifactRoot = await fs.realpath(path.resolve(rootDir));
  const [stable, resources, profile, contract] = await Promise.all([
    readJson(artifactRoot, "inventory/packages.lock.json"),
    readJson(artifactRoot, "inventory/resources.lock.json"),
    readJson(artifactRoot, "profiles/daily.json"),
    readJson(artifactRoot, "contracts/compatibility/upstream-candidates.json"),
  ]);
  assertExactContract(contract);
  return planOwnedGraph({ packageInventory: candidatePackageInventory(stable, contract), resourceInventory: resources, profile, artifactRoot });
}

export async function buildCandidateBoundGraphPlan({ rootDir, manifest, profileId = "daily" } = {}) {
  const plan = await buildCandidateGenerationPlan({ rootDir, profileId });
  const target = new Map(manifest?.externalPackages?.map((entry) => [entry.id, entry]) ?? []);
  const packageBindings = plan.packages.map((entry) => {
    const evidence = target.get(entry.id);
    if (!evidence || evidence.name !== entry.source.name || evidence.toVersion !== entry.source.version || evidence.toIntegrity !== entry.integrity) {
      throw Object.assign(new Error(`candidate binding evidence drifted for ${entry.id}`), { code: "CANDIDATE_BINDING_DRIFT" });
    }
    return {
      id: entry.id,
      name: entry.source.name,
      binding: "external",
      sourceSpec: entry.spec,
      resolvedVersion: entry.source.version,
      integrity: entry.integrity,
      resolvedUrlDigest: evidence.toResolvedUrlDigest,
      physicalRootDigest: evidence.toTreeDigest,
      owner: "user",
      resourceFilter: [...entry.resourceFilter],
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const bound = { ...plan, packages: [], packageBindings };
  delete bound.graphDigest;
  delete bound.generationKey;
  const graphDigest = computeOwnedGraphDigest(bound);
  return Object.freeze({ ...bound, graphDigest, generationKey: generationKeyFromDigest(graphDigest) });
}

export function createCandidateTargetResolver({ rootDir } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("candidate target resolver requires an absolute rootDir");
  return Object.freeze({
    async inspect({ manifest } = {}) {
      const plan = await buildCandidateBoundGraphPlan({ rootDir, manifest });
      if (plan.graphDigest !== manifest.candidateGraphDigest) {
        throw Object.assign(new Error("migration manifest candidate graph differs from the artifact-contained target"), { code: "CANDIDATE_GRAPH_DIGEST_DRIFT" });
      }
      return Object.freeze({ graphDigest: plan.graphDigest, generationKey: plan.generationKey, profileId: plan.profileId, externalBindings: plan.packageBindings.length });
    },
    async alignInstalled({ configRoot, settings, metadata, profileId = "daily" } = {}) {
      if (profileId !== "daily") throw new TypeError("candidate alignment is available only for the daily profile");
      const plan = await buildCandidateGenerationPlan({ rootDir, profileId });
      return bindExistingPackages({
        configRoot,
        settings,
        plan,
        priorBindings: metadata?.packageBindings,
      });
    },
  });
}
