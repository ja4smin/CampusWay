// CampusWay local database: plain JSON files in one folder on this PC.
//
// Each collection is one readable file (reports.json, usage.json, ...).
// Writes go to a temporary file first and are then renamed over the old one,
// so a crash or power cut never leaves a half-written file behind.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonDb{
  constructor(directory){
    this.directory = directory;
    this.cache = new Map();
    fs.mkdirSync(directory, {recursive:true});
  }

  file(name){
    return path.join(this.directory, `${name}.json`);
  }

  read(name, fallback){
    if(this.cache.has(name)) return this.cache.get(name);
    let value = fallback;
    try{
      value = JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    }catch(error){
      if(error.code !== 'ENOENT'){
        // Keep the damaged file for inspection and start from the fallback.
        const broken = `${this.file(name)}.broken-${Date.now()}`;
        try{ fs.renameSync(this.file(name), broken); }catch(renameError){ /* ignore */ }
        console.warn(`[db] ${name}.json could not be read and was moved to ${path.basename(broken)}.`);
      }
    }
    this.cache.set(name, value);
    return value;
  }

  write(name, value){
    const target = this.file(name);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, target);
    this.cache.set(name, value);
    return value;
  }

  // Read, change and save in one step: update('reports', [], list => ...)
  update(name, fallback, change){
    const current = this.read(name, fallback);
    const next = change(current);
    return this.write(name, next === undefined ? current : next);
  }
}

module.exports = {JsonDb};
