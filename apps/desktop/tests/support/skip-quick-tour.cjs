const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Smokes for other features start past the first-run tour.
module.exports = (profile) => {
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'quick-tour.json'), '{"seen":true}');
};
