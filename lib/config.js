const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.fist-steering');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  camera: 0,
  smooth: 0.20,
  deadzone: 0.05,
  tilt: 45.0,
  disableBrake: false,
  eyebrowThreshold: 0.18,
  disableThrottle: false,
  throttleValue: 0.40,
  disablePalm: false,
  palmFingers: 3
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('⚠️ Could not parse config.json. Using defaults.');
    return null;
  }
}

function saveConfig(config) {
  ensureConfigDir();
  const merged = { ...DEFAULT_CONFIG, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
}

function getConfig() {
  const loaded = loadConfig();
  if (!loaded) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...loaded };
}

function deleteConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
  }
}

module.exports = {
  CONFIG_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  getConfig,
  deleteConfig
};
