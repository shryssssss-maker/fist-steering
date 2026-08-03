#!/usr/bin/env node
const mri = require('mri');
const fs = require('fs');
const updateChecker = require('../lib/update-checker');
const configLib = require('../lib/config');
const pythonLib = require('../lib/python');
const setupLib = require('../lib/setup');
const doctorLib = require('../lib/doctor');
const reportLib = require('../lib/report');
const benchmarkLib = require('../lib/benchmark');

async function main() {
  // 1. Enforce Windows Only
  if (process.platform !== 'win32') {
    console.error('\x1b[31m%s\x1b[0m', '❌ Fist Steering currently supports Windows only.');
    console.error('This package emulates an Xbox controller using ViGEmBus, which is only available on Windows.');
    process.exit(1);
  }

  // 2. Parse arguments
  const args = process.argv.slice(2);
  const argv = mri(args, {
    boolean: ['help', 'version'],
    alias: { h: 'help', v: 'version' }
  });

  const command = argv._[0] || 'start';

  if (argv.version || command === 'version') {
    console.log(require('../package.json').version);
    return;
  }

  if (argv.help || command === 'help') {
    console.log(`
\x1b[1m\x1b[36mFist Steering Wheel Controller\x1b[0m

Usage:
  $ npx fist-steering [command]

Commands:
  start          Launch the controller (default)
  setup          Run the configuration wizard
  config         Alias for setup
  reset          Delete config and re-run setup
  doctor         Run system health checks
  benchmark      Run performance test (Ctrl+C to stop)
                 Options: --time <seconds>
  update         Repair/update Python environment
  report         Generate diagnostic report (fist-steering-report.md)
  help           Show this help message
`);
    return;
  }

  // Check for updates in the background on startup (don't block)
  updateChecker.checkForUpdates();

  switch (command) {
    case 'setup':
    case 'config':
      await setupLib.runSetup();
      break;
    
    case 'reset':
      configLib.deleteConfig();
      await setupLib.runSetup();
      break;
    
    case 'doctor':
      await doctorLib.runDoctor();
      break;
    
    case 'update':
      console.log('Forcing rebuild of Python environment...');
      pythonLib.cleanVenv();
      await pythonLib.ensureVenv(true);
      console.log('\x1b[32m✨ Update complete!\x1b[0m');
      break;

    case 'report':
      reportLib.runReport();
      break;
    
    case 'benchmark':
      await benchmarkLib.runBenchmark(argv.time);
      break;
    
    case 'start':
    default:
      // If config doesn't exist, run setup first
      if (!fs.existsSync(configLib.CONFIG_PATH)) {
        await setupLib.runSetup();
      }
      
      const conf = configLib.getConfig();
      await pythonLib.ensureVenv(true);
      
      const pyArgs = [
        '--camera', conf.camera.toString(),
        '--smooth', conf.smooth.toString(),
        '--deadzone', conf.deadzone.toString(),
        '--tilt', conf.tilt.toString(),
        '--eyebrow-threshold', conf.eyebrowThreshold.toString(),
        '--throttle-value', conf.throttleValue.toString(),
        '--palm-fingers', conf.palmFingers.toString()
      ];
      if (conf.disableBrake) pyArgs.push('--disable-brake');
      if (conf.disableThrottle) pyArgs.push('--disable-throttle');
      if (conf.disablePalm) pyArgs.push('--disable-palm');

      console.log('\x1b[36m%s\x1b[0m', 'Launching python tracking backend...');
      await pythonLib.runPythonScript(pyArgs, true);
      break;
  }
}

main().catch(err => {
  console.error('\x1b[31m%s\x1b[0m', 'Unexpected error:');
  console.error(err);
  process.exit(1);
});
