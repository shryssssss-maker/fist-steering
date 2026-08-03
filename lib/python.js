const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { confirm } = require('@inquirer/prompts');

const venvDir = path.join(os.homedir(), '.fist-steering-env');
const runtimeDir = path.join(venvDir, 'runtime');
const isWindows = process.platform === 'win32';
const venvPython = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python'); // (Even though we enforce Windows, keep it generic just in case)

const REQUIRED_DEPS = ['opencv-python', 'mediapipe==0.10.21', 'vgamepad', 'pynput'];

function getPortablePythonExecutable() {
  const candidates = [
    path.join(runtimeDir, 'python', 'python.exe'),
    path.join(runtimeDir, 'python.exe'),
    path.join(runtimeDir, 'install', 'python.exe')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const ver = execSync(`"${c}" --version`, { encoding: 'utf-8' }).trim();
        if (ver.includes('Python 3.11') || ver.includes('Python 3.10') || ver.includes('Python 3.9') || ver.includes('Python 3.8')) {
          return c;
        }
      } catch (e) {}
    }
  }
  return null;
}

function getSystemPythonExecutable(enforceVersion = false) {
  // First check if portable Python was already downloaded in runtime/
  const portablePy = getPortablePythonExecutable();
  if (portablePy) {
    return `"${portablePy}"`;
  }

  const candidates = [
    'py -3.11',
    'py -3.10',
    'py -3.9',
    'py -3.8',
    'python3.11',
    'python3.10',
    'python3.9',
    'python3.8',
    'python',
    'py',
    'python3'
  ];
  for (const cmd of candidates) {
    try {
      const ver = execSync(`${cmd} --version`, { encoding: 'utf-8' }).trim();
      if (enforceVersion) {
        const match = ver.match(/Python (\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1]);
          const minor = parseInt(match[2]);
          if (major === 3 && minor >= 8 && minor <= 11) {
            return cmd;
          }
        }
      } else {
        return cmd;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    
    function makeRequest(currentUrl, maxRedirects = 5) {
      if (maxRedirects <= 0) {
        return reject(new Error('Too many redirects while downloading Python runtime.'));
      }
      
      const client = currentUrl.startsWith('https') ? https : http;
      client.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return makeRequest(response.headers.location, maxRedirects - 1);
        }
        
        if (response.statusCode !== 200) {
          fileStream.close();
          return reject(new Error(`Download failed with HTTP status ${response.statusCode}`));
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let receivedBytes = 0;

        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          fileStream.write(chunk);
          if (totalBytes > 0) {
            const pct = Math.round((receivedBytes / totalBytes) * 100);
            const mb = (receivedBytes / (1024 * 1024)).toFixed(1);
            const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
            process.stdout.write(`\r📥 Downloading Python 3.11: ${mb}MB / ${totalMb}MB (${pct}%)`);
          }
        });

        response.on('end', () => {
          fileStream.end(() => {
            process.stdout.write('\n');
            resolve();
          });
        });

        response.on('error', (err) => {
          fileStream.close();
          reject(err);
        });
      }).on('error', (err) => {
        fileStream.close();
        reject(err);
      });
    }

    makeRequest(url);
  });
}

function extractArchive(archivePath, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  try {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
    return true;
  } catch (e) {
    try {
      execSync(`powershell -Command "tar -xzf '${archivePath}' -C '${destDir}'"`, { stdio: 'inherit' });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

async function downloadPortablePython() {
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  const archiveUrl = 'https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-pc-windows-msvc-install_only.tar.gz';
  const tempArchive = path.join(runtimeDir, 'python-3.11.tar.gz');

  console.log('\n📦 Downloading portable Python 3.11 runtime (~25 MB)...');

  await downloadFile(archiveUrl, tempArchive);

  console.log('📦 Extracting Python 3.11 runtime...');
  const extracted = extractArchive(tempArchive, runtimeDir);
  
  if (fs.existsSync(tempArchive)) {
    try { fs.unlinkSync(tempArchive); } catch (e) {}
  }

  if (!extracted) {
    throw new Error('Failed to extract Python 3.11 runtime archive.');
  }

  const portableExe = getPortablePythonExecutable();
  if (!portableExe) {
    throw new Error('Python 3.11 executable not found after extraction.');
  }

  console.log('\x1b[32m✓ Portable Python 3.11 runtime ready!\x1b[0m\n');
  return `"${portableExe}"`;
}

async function createVenv() {
  let systemPythonCmd = getSystemPythonExecutable(true);

  if (!systemPythonCmd) {
    const anyPy = getSystemPythonExecutable(false);
    let currentVer = 'Not found';
    if (anyPy) {
      try {
        currentVer = execSync(`${anyPy} --version`, { encoding: 'utf-8' }).trim();
      } catch (e) {}
    }

    console.log('\n\x1b[1m\x1b[33m⚠️ Python Compatibility Notice\x1b[0m\n');
    if (anyPy) {
      console.log(`❌ Found: \x1b[1m${currentVer}\x1b[0m (Unsupported)`);
    } else {
      console.log('❌ Python was not found on your system.');
    }
    console.log('   Fist Steering requires \x1b[32mPython 3.8, 3.9, 3.10, or 3.11\x1b[0m.');
    console.log('   \x1b[90m(Google MediaPipe AI models do not support newer Python versions like 3.12+ yet.)\x1b[0m\n');
    console.log('\x1b[36m💡 Solution:\x1b[0m We can automatically download a portable, isolated copy of Python 3.11 (~25 MB).');
    console.log('   • It will NOT change your Windows PATH.');
    if (anyPy) {
      console.log(`   • It will NOT modify or overwrite your existing ${currentVer}.`);
    }
    console.log('   • It requires NO Administrator permissions.\n');

    let shouldDownload = false;
    try {
      shouldDownload = await confirm({
        message: 'Would you like to auto-download portable Python 3.11 now?',
        default: true
      });
    } catch (e) {
      shouldDownload = false;
    }

    if (!shouldDownload) {
      console.log('\n\x1b[33mSetup cancelled.\x1b[0m\n');
      console.log('To run Fist Steering later:');
      console.log('  1. Manually install Python 3.11 from https://www.python.org/ (check "Add to PATH")');
      console.log('  2. Re-run: npx fist-steering\n');
      process.exit(0);
    }

    try {
      systemPythonCmd = await downloadPortablePython();
    } catch (err) {
      console.error('\x1b[31m%s\x1b[0m', '❌ Failed to download portable Python 3.11.');
      console.error(err.message);
      process.exit(1);
    }
  }
  
  try {
    execSync(`${systemPythonCmd} -m venv "${venvDir}"`, { stdio: 'ignore' });
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Failed to create Python virtual environment.');
    console.error(err.message);
    process.exit(1);
  }
}

function cleanVenv(cleanRuntime = false) {
  if (fs.existsSync(venvDir)) {
    try {
      const items = fs.readdirSync(venvDir);
      for (const item of items) {
        if (!cleanRuntime && item === 'runtime') continue;
        fs.rmSync(path.join(venvDir, item), { recursive: true, force: true });
      }
    } catch (e) {
      console.error('\x1b[31m%s\x1b[0m', '❌ Failed to clean old virtual environment. Please delete it manually: ' + venvDir);
      process.exit(1);
    }
  }
}

function installDeps(quiet = false) {
  try {
    if (quiet) {
      execSync(`"${venvPython}" -m pip install ${REQUIRED_DEPS.join(' ')}`, { stdio: 'pipe' });
    } else {
      execSync(`"${venvPython}" -m pip install ${REQUIRED_DEPS.join(' ')}`, { stdio: 'inherit' });
    }
    return true;
  } catch (err) {
    if (quiet) {
      console.error('\n\x1b[31m%s\x1b[0m', '❌ Pip installation failed! Error output:');
      console.error(err.stderr ? err.stderr.toString() : err.message);
    }
    return false;
  }
}

function isVenvHealthy() {
  if (!fs.existsSync(venvPython)) return false;
  try {
    execSync(`"${venvPython}" -c "import cv2, mediapipe, vgamepad, pynput"`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureVenv(verbose = false) {
  if (isVenvHealthy()) return true;

  console.log('\x1b[33m%s\x1b[0m', '⚠️ First time setup: Building isolated Python environment...');
  
  cleanVenv();
  await createVenv();

  console.log('📦 Downloading AI models and dependencies (this takes 1-2 minutes)...');
  console.log('------------------------------------------------------------------');
  
  const success = installDeps(false); // Show pip progress for transparency
  
  console.log('------------------------------------------------------------------');
  
  if (!success) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Failed to install Python dependencies into venv.');
    console.error('Run "npx fist-steering doctor" to diagnose.');
    process.exit(1);
  }
  return true;
}

function runPythonScript(args, interactive = true) {
  const scriptPath = path.join(__dirname, '..', 'fist_steering.py');
  if (!fs.existsSync(scriptPath)) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Error: Could not locate script at ${scriptPath}`);
    process.exit(1);
  }

  const pyArgs = [scriptPath, ...args];
  
  if (!interactive) {
    try {
      return execSync(`"${venvPython}" ${pyArgs.join(' ')}`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (err) {
      return null;
    }
  }

  const pyProcess = spawn(venvPython, pyArgs, { stdio: 'inherit' });

  // Ensure python process is killed if node dies
  const killPy = () => {
    try {
      pyProcess.kill('SIGKILL');
    } catch (e) {}
  };

  process.on('SIGINT', killPy);
  process.on('SIGTERM', killPy);
  process.on('exit', killPy);

  return new Promise((resolve) => {
    pyProcess.on('close', (code) => {
      resolve(code);
    });
  });
}

async function getCameras() {
  await ensureVenv();
  const output = runPythonScript(['--probe-cameras'], false);
  if (!output) return [];
  try {
    const startIndex = output.indexOf('[');
    const endIndex = output.lastIndexOf(']');
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      return JSON.parse(output.substring(startIndex, endIndex + 1));
    }
    return JSON.parse(output);
  } catch (e) {
    console.error('\x1b[33m%s\x1b[0m', '⚠️ Warning: Failed to parse camera list. Raw output:');
    console.error(output);
    return [];
  }
}

module.exports = {
  venvDir,
  runtimeDir,
  venvPython,
  REQUIRED_DEPS,
  getPortablePythonExecutable,
  getSystemPythonExecutable,
  downloadPortablePython,
  cleanVenv,
  createVenv,
  installDeps,
  isVenvHealthy,
  ensureVenv,
  runPythonScript,
  getCameras
};
