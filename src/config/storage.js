const fs = require('fs');
const path = require('path');

function ensureJsonFile(filePath) {
  const directory = path.dirname(filePath);

  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]');
  }

  return filePath;
}

function resolveStorageFile(envVarName, defaultRelativePath) {
  const configuredPath = process.env[envVarName];
  const resolvedPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(__dirname, '..', defaultRelativePath);

  return ensureJsonFile(resolvedPath);
}

module.exports = {
  resolveStorageFile
};
