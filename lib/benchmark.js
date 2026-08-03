const pythonLib = require('./python');
const configLib = require('./config');

async function runBenchmark(timeStr) {
  console.log('\x1b[36m%s\x1b[0m', 'Starting benchmark mode...');
  const conf = configLib.getConfig();

  const args = ['--benchmark'];
  if (timeStr) {
    args.push('--benchmark-time', timeStr);
  }
  
  args.push('--camera', conf.camera.toString());
  if (conf.disableBrake) args.push('--disable-brake');
  if (conf.disableThrottle) args.push('--disable-throttle');
  if (conf.disablePalm) args.push('--disable-palm');

  await pythonLib.ensureVenv();
  await pythonLib.runPythonScript(args, true);
}

module.exports = { runBenchmark };
