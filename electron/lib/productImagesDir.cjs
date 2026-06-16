'use strict';

const path = require('path');
const fs = require('fs');
const { getUserDataDir } = require('./runtime.cjs');

function getProductImagesDir() {
  const dir = path.join(getUserDataDir(), 'product-images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { getProductImagesDir };
