const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const pythonLib = require('./python');
const configLib = require('./config');

function runReport() {
  console.log('Generating diagnostic report...');

  const report = [];
  report.push('# Fist Steering Diagnostic Report\n');

  report.push('## System Information');
  report.push(`- **OS**: ${os.type()} ${os.release()} (${os.arch()})`);
  report.push(`- **Node**: ${process.version}`);
  
  const portablePy = pythonLib.getPortablePythonExecutable();
  const pyCmd = pythonLib.getSystemPythonExecutable();
  let pyVer = 'Not found';
  if (portablePy) {
    try {
      pyVer = `${execSync(`"${portablePy}" --version`, { encoding: 'utf-8' }).trim()} (Portable Runtime)`;
    } catch(e) {}
  } else if (pyCmd) {
    try {
      pyVer = execSync(`${pyCmd} --version`, { encoding: 'utf-8' }).trim();
    } catch(e) {}
  }
  report.push(`- **Python Runtime**: ${pyVer}`);
  
  const venvHealthy = pythonLib.isVenvHealthy();
  report.push(`- **VENV Status**: ${venvHealthy ? 'Healthy' : 'Corrupted / Missing'}`);
  report.push('');

  report.push('## Configuration');
  report.push('```json');
  const conf = configLib.loadConfig();
  if (conf) {
    report.push(JSON.stringify(conf, null, 2));
  } else {
    report.push('{} // Missing or corrupt');
  }
  report.push('```\n');

  const dest = path.join(process.cwd(), 'fist-steering-report.md');
  fs.writeFileSync(dest, report.join('\n'), 'utf-8');

  console.log('\x1b[32m✨ Report generated at:\x1b[0m', dest);
  console.log('Please attach this file when opening an issue on GitHub.');
}

module.exports = { runReport };
