const { select, confirm, input } = require('@inquirer/prompts');
const configLib = require('./config');
const pythonLib = require('./python');

async function runSetup() {
  console.log('\n\x1b[1m\x1b[36m🎮 Fist Steering - Setup Wizard\x1b[0m\n');
  console.log('Let\'s configure your virtual steering wheel.\n');

  console.log('Probing cameras (this may take a few seconds)...');
  const cameras = await pythonLib.getCameras();
  
  if (cameras.length === 0) {
    console.error('\n\x1b[31m❌ No cameras detected!\x1b[0m');
    console.error('Please check your USB connections and Windows Privacy Settings.');
    console.error('Run "npx fist-steering doctor" for more info.\n');
    process.exit(1);
  }

  const cameraChoices = cameras.map(c => ({
    name: `[${c.index}] ${c.name}`,
    value: c.index
  }));

  const answers = {};

  answers.camera = await select({
    message: 'Which camera would you like to use?',
    choices: cameraChoices
  });

  answers.disableBrake = !(await confirm({
    message: 'Enable eyebrow-raise braking? (Requires FaceMesh AI, uses more CPU)',
    default: true
  }));

  const smoothStr = await input({
    message: 'Steering Smoothing (0.0 = raw, 1.0 = frozen, recommended: 0.20):',
    default: '0.20',
    validate: (val) => {
      const n = parseFloat(val);
      if (isNaN(n) || n < 0 || n >= 1) return 'Please enter a number between 0.0 and 0.99';
      return true;
    }
  });
  answers.smooth = parseFloat(smoothStr);

  const deadzoneStr = await input({
    message: 'Steering Deadzone (0.0 = none, recommended: 0.05 to ignore small jitters):',
    default: '0.05',
    validate: (val) => {
      const n = parseFloat(val);
      if (isNaN(n) || n < 0 || n >= 1) return 'Please enter a number between 0.0 and 0.99';
      return true;
    }
  });
  answers.deadzone = parseFloat(deadzoneStr);

  console.log('\nSaving configuration...');
  configLib.saveConfig(answers);
  
  console.log('\x1b[32m✨ Setup complete!\x1b[0m');
  console.log('You can change these settings later by running: npx fist-steering config\n');
}

module.exports = {
  runSetup
};
