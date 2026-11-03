function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`not a plain semver: ${version}`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (kind === 'minor') [minor, patch] = [minor + 1, 0];
  else if (kind === 'patch') patch += 1;
  else throw new Error('usage: bump-version.mjs <major|minor|patch>');
  return `${major}.${minor}.${patch}`;
}

module.exports = { bump };
