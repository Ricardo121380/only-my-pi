import { setTimeout } from "node:timers/promises";

export async function awaitPublishedVersion({ inspect, name, version, integrity, wait = setTimeout,
  delays = [0, 2000, 5000, 10000, 20000] }) {
  let published;
  for (const delay of delays) {
    if (delay) await wait(delay);
    published = await inspect();
    if (!published) continue;
    if (published.name !== name || published.version !== version || published.dist?.integrity !== integrity)
      throw new Error(`immutable npm version has different bytes: ${name}@${version}`);
    if (published.dist.attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1") return published;
  }
  throw new Error(`${published ? "npm provenance missing" : "npm version not visible after bounded registry checks"}: ${name}@${version}; inspect the submission receipt before retrying`);
}
