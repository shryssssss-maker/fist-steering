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

/**
 * Set a single key in the saved config without re-running the full wizard.
 * Returns { ok, message } so the caller can print a result.
 */
function setConfigKey(key, rawValue) {
  if (!(key in DEFAULT_CONFIG)) {
    const valid = Object.keys(DEFAULT_CONFIG).join(', ');
    return { ok: false, message: `Unknown key "${key}". Valid keys: ${valid}` };
  }

  const defaultVal = DEFAULT_CONFIG[key];
  let parsed;

  if (typeof defaultVal === 'boolean') {
    if (rawValue === 'true' || rawValue === '1') parsed = true;
    else if (rawValue === 'false' || rawValue === '0') parsed = false;
    else return { ok: false, message: `"${key}" expects true or false.` };
  } else if (typeof defaultVal === 'number') {
    parsed = Number(rawValue);
    if (isNaN(parsed)) return { ok: false, message: `"${key}" expects a number.` };
  } else {
    parsed = rawValue;
  }

  const current = getConfig();
  current[key] = parsed;
  saveConfig(current);
  return { ok: true, message: `${key} = ${parsed}` };
}

module.exports = {
  CONFIG_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  getConfig,
  deleteConfig,
  setConfigKey
};
