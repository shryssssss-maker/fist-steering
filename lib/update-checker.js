const pkg = require('../package.json');

/**
 * Returns true when the package is being executed via `npx fist-steering`.
 * npx extracts packages into a temp directory that contains '_npx' in the path.
 */
function isRunningViaNpx() {
  return __dirname.includes('_npx') ||
    (process.env.npm_execpath || '').toLowerCase().includes('npx');
}

/**
 * Simple semver comparison. Returns true if `a` is strictly less than `b`.
 * Handles only MAJOR.MINOR.PATCH (no pre-release tags).
 */
function semverLt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return true;
    if ((pa[i] || 0) > (pb[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.version) return;

    // Only show banner if npm has a NEWER version (don't alert on dev builds)
    if (!semverLt(pkg.version, data.version)) return;

    const viaNpx    = isRunningViaNpx();
    const updateCmd = viaNpx
      ? `npx ${pkg.name}@latest`
      : `npm update -g ${pkg.name}`;

    const line1 = ` Update available!  ${pkg.version}  \u2192  ${data.version} `;
    const line2 = ` Run: ${updateCmd} `;
    const width = Math.max(line1.length, line2.length) + 2;
    const bar   = '\u2500'.repeat(width);

    console.log(`\n\x1b[33m\u256d${bar}\u256e\x1b[0m`);
    console.log(`\x1b[33m\u2502\x1b[0m${line1.padEnd(width)}\x1b[33m\u2502\x1b[0m`);
    console.log(`\x1b[33m\u2502\x1b[0m${line2.padEnd(width)}\x1b[33m\u2502\x1b[0m`);
    console.log(`\x1b[33m\u2570${bar}\u256f\x1b[0m\n`);
  } catch (_) {
    // silently fail — never block startup for an update check
  }
}

module.exports = { checkForUpdates };
