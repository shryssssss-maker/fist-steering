const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');
const configLib = require('./config');
const pythonLib = require('./python');

function checkAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function runDoctor() {
  console.log('\n\x1b[1m\x1b[36mDoctor Report\x1b[0m\n');

  let allGood = true;

  const logCheck = (name, ok, value, suggestion) => {
    if (ok) {
      console.log(`\x1b[32m✓\x1b[0m ${name}`);
      console.log(`  └─ ${value}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m ${name}`);
      console.log(`  └─ \x1b[31m${value}\x1b[0m`);
      if (suggestion) {
        console.log(`     \x1b[33mSuggested Fix:\x1b[0m ${suggestion}`);
      }
      allGood = false;
    }
    console.log();
  };

  // Advisory-only check — does NOT affect allGood
  const logWarn = (name, value, note) => {
    console.log(`\x1b[33m⚠\x1b[0m ${name}`);
    console.log(`  └─ \x1b[33m${value}\x1b[0m`);
    if (note) console.log(`     ${note}`);
    console.log();
  };

  // 1. Operating System
  const isWin = process.platform === 'win32';
  logCheck('Operating System', isWin, os.type() + ' ' + os.release(), 'Use Windows 10 or 11.');

  // 2. Node
  logCheck('Node', true, process.version);

  // 3. Python Runtime
  const portablePy = pythonLib.getPortablePythonExecutable();
  const pyCmdValid = pythonLib.getSystemPythonExecutable(true);
  const pyCmdAny = pythonLib.getSystemPythonExecutable(false);

  if (portablePy) {
    try {
      const ver = execSync(`"${portablePy}" --version`, { encoding: 'utf-8' }).trim();
      logCheck('Python Runtime', true, `${ver} (Isolated Portable Runtime in ~/.fist-steering-env/runtime/)`);
    } catch (e) {
      logCheck('Python Runtime', false, 'Portable Python installed but failing to run', 'Run: npx fist-steering update');
    }
  } else if (pyCmdValid) {
    try {
      const ver = execSync(`${pyCmdValid} --version`, { encoding: 'utf-8' }).trim();
      logCheck('Python (System)', true, ver);
    } catch (e) {
      logCheck('Python (System)', false, 'Installed but failing to run', 'Reinstall Python 3.11 or run npx fist-steering');
    }
  } else if (pyCmdAny) {
    try {
      const ver = execSync(`${pyCmdAny} --version`, { encoding: 'utf-8' }).trim();
      logCheck('Python (System)', false, `${ver} (Unsupported)`, 'MediaPipe requires Python 3.8-3.11. Run "npx fist-steering" to auto-download portable Python 3.11.');
    } catch (e) {}
  } else {
    logCheck('Python (System)', false, 'Not found on PATH', 'Run "npx fist-steering" to auto-download portable Python 3.11 without setup.');
  }

  // 4. Virtual Environment
  const venvHealthy = pythonLib.isVenvHealthy();
  logCheck('Virtual Environment', venvHealthy, venvHealthy ? 'Healthy' : 'Missing or Corrupted', 'Run: npx fist-steering update');

  // 5. Python Dependencies
  if (venvHealthy) {
    const deps = ['cv2 (OpenCV)', 'mediapipe', 'vgamepad', 'pynput'];
    for (const dep of deps) {
      const pkg = dep.split(' ')[0];
      try {
        execSync(`"${pythonLib.venvPython}" -c "import ${pkg}"`, { stdio: 'ignore' });
        logCheck(dep, true, 'Installed');
      } catch (e) {
        logCheck(dep, false, 'Missing', 'Run: npx fist-steering update');
      }
    }
  } else {
    console.log('\x1b[33m⚠️ Skipping Python dependencies check due to unbuilt or broken VENV.\x1b[0m\n');
  }

  // 6. Camera
  console.log('Checking cameras (this might take a few seconds)...');
  const cameras = await pythonLib.getCameras();
  if (cameras.length > 0) {
    const names = cameras.map(c => `[${c.index}] ${c.name}`).join(' | ');
    logCheck('Camera', true, `Found ${cameras.length}: ${names}`);
  } else {
    logCheck('Camera', false, 'No compatible cameras found', 'Check USB connection and Windows Privacy Settings.');
  }

  // 7. Administrator (advisory only — app works fine without it in most cases)
  const isAdmin = checkAdmin();
  if (isAdmin) {
    console.log(`\x1b[32m✓\x1b[0m Administrator`);
    console.log(`  └─ Yes\n`);
  } else {
    logWarn('Administrator', 'Not elevated', 'Only needed if ViGEmBus fails. Run terminal as Admin to fix.');
  }

  // 8. Configuration
  const conf = configLib.loadConfig();
  if (conf) {
    logCheck('Configuration', true, 'Valid (JSON parsed)');
  } else {
    if (fs.existsSync(configLib.CONFIG_PATH)) {
      logCheck('Configuration', false, 'Invalid JSON format', 'Run: npx fist-steering reset');
    } else {
      logCheck('Configuration', true, 'Using Defaults (No config file yet)');
    }
  }

  // Summary
  if (allGood) {
    console.log('\x1b[32m✨ Everything looks good!\x1b[0m');
  } else {
    console.log('\x1b[31m⚠️ Doctor found issues that may prevent the app from working.\x1b[0m');
  }
}

module.exports = {
  runDoctor
};
