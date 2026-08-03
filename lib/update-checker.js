const pkg = require('../package.json');

async function checkForUpdates() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`);
    if (!res.ok) return;
    const data = await res.json();
    
    if (data.version && data.version !== pkg.version) {
      console.log('\n\x1b[33m%s\x1b[0m', '╭───────────────────────────────────────────────────╮');
      console.log('\x1b[33m%s\x1b[0m', `│ Update available! ${pkg.version} → ${data.version}`.padEnd(51) + '│');
      console.log('\x1b[33m%s\x1b[0m', `│ Run "npm i -g ${pkg.name}" to update.`.padEnd(51) + '│');
      console.log('\x1b[33m%s\x1b[0m', '╰───────────────────────────────────────────────────╯\n');
    }
  } catch (err) {
    // silently fail
  }
}

module.exports = {
  checkForUpdates
};
