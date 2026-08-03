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
  setup          Run the full configuration wizard
  config         Alias for setup
  config show    Print current settings
  config set <key> <value>
                 Change one setting without re-running the wizard
  reset          Delete config and re-run setup
  doctor         Run system health checks
  benchmark      Run performance test (Ctrl+C to stop)
                 Options: --time <seconds>
  update         Repair/update Python environment
  report         Generate diagnostic report (fist-steering-report.md)
  version        Print version number
  help           Show this help message

Flags:
  -v, --version  Print version number
  -h, --help     Show this help message

Config keys (for config set):
  camera           Camera index (default: 0)
  smooth           Steering smoothing 0.0–1.0 (default: 0.20)
  deadzone         Deadzone 0.0–0.5 (default: 0.05)
  tilt             Max tilt angle in degrees (default: 45)
  eyebrowThreshold Eyebrow raise sensitivity (default: 0.18)
  throttleValue    Throttle hold strength (default: 0.40)
  palmFingers      Fingers needed for palm-open (default: 3)
  disableBrake     true/false (default: false)
  disableThrottle  true/false (default: false)
  disablePalm      true/false (default: false)

Examples:
  npx fist-steering
  npx fist-steering config show
  npx fist-steering config set camera 1
  npx fist-steering config set smooth 0.30
  npx fist-steering benchmark --time 30

Bugs / Feedback:
  https://github.com/shryssssss-maker/fist-steering/issues
  Run \x1b[36mnpx fist-steering report\x1b[0m first to generate a diagnostic file to attach.
`);
    return;
  }

  // Check for updates in the background on startup (don't block)
  updateChecker.checkForUpdates();

  switch (command) {
    case 'setup':
      await setupLib.runSetup();
      break;

    case 'config': {
      const sub = argv._[1]; // show | set | (none = wizard)
      if (sub === 'show') {
        const conf = configLib.getConfig();
        const src = configLib.loadConfig() ? configLib.CONFIG_PATH : 'defaults';
        console.log(`\n\x1b[1m\x1b[36mCurrent Configuration\x1b[0m  (${src})\n`);
        const pad = 20;
        for (const [k, v] of Object.entries(conf)) {
          const def = configLib.DEFAULT_CONFIG[k];
          const isDefault = v === def;
          const tag = isDefault ? '\x1b[90m(default)\x1b[0m' : '\x1b[32m(custom)\x1b[0m';
          console.log(`  ${k.padEnd(pad)} ${String(v).padEnd(10)} ${tag}`);
        }
        console.log();
      } else if (sub === 'set') {
        const key = argv._[2];
        const val = argv._[3];
        if (!key || val === undefined) {
          console.error('Usage: npx fist-steering config set <key> <value>');
          console.error('Run `npx fist-steering help` to see all valid keys.');
          process.exit(1);
        }
        const result = configLib.setConfigKey(key, String(val));
        if (result.ok) {
          console.log(`\x1b[32m✓\x1b[0m Saved: ${result.message}`);
        } else {
          console.error(`\x1b[31m✗\x1b[0m ${result.message}`);
          process.exit(1);
        }
      } else {
        // no sub-command — run the full wizard
        await setupLib.runSetup();
      }
      break;
    }
    
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
  console.error('\n\x1b[33m🐛 If this keeps happening, open an issue at:\x1b[0m');
  console.error('   \x1b[36mhttps://github.com/shryssssss-maker/fist-steering/issues\x1b[0m');
  console.error('   Run `npx fist-steering report` to generate a diagnostic file to attach.\n');
  process.exit(1);
});
