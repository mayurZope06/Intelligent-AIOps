const fs = require('fs');
const path = require('path');

class Storage {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    this.ensureDataDir();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  getFilePath(filename) {
    return path.join(this.dataDir, filename);
  }

  read(filename, defaultVal = []) {
    const filePath = this.getFilePath(filename);
    try {
      if (!fs.existsSync(filePath)) {
        this.write(filename, defaultVal);
        return defaultVal;
      }
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error(`[Storage] Failed to read ${filename}:`, err.message);
      return defaultVal;
    }
  }

  write(filename, data) {
    this.ensureDataDir();
    const filePath = this.getFilePath(filename);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error(`[Storage] Failed to write ${filename}:`, err.message);
      return false;
    }
  }
}

module.exports = new Storage();
