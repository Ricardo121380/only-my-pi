export function selectReleaseByTag(releases, tag) {
  const matches = releases.filter((release) => release.tag_name === tag);
  if (matches.length > 1) throw new Error(`Multiple releases match ${tag}; inspect drafts before recovery.`);
  return matches[0] ?? null;
}
