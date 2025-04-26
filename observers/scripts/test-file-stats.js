/**
 * Test script to examine file stats properties
 * This will help determine which properties are reliable for getting creation dates on Mac
 */

const fs = require('fs');
const path = require('path');

// Function to test file stats for a given file
function testFileStats(filePath) {
  console.log(`\nTesting file stats for: ${filePath}`);
  
  try {
    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Print all available properties and their values
    console.log('\nAll available stats properties:');
    console.log('----------------------------');
    for (const prop in stats) {
      if (stats[prop] instanceof Date) {
        console.log(`${prop}: ${stats[prop].toISOString()} (${stats[prop]})`);
      } else if (typeof stats[prop] !== 'function') {
        console.log(`${prop}: ${stats[prop]}`);
      }
    }
    
    // Compare specific time properties
    console.log('\nTime properties comparison:');
    console.log('-------------------------');
    if (stats.birthtime) console.log(`birthtime: ${stats.birthtime.toISOString()}`);
    if (stats.mtime) console.log(`mtime (Modified): ${stats.mtime.toISOString()}`);
    if (stats.ctime) console.log(`ctime (Changed): ${stats.ctime.toISOString()}`);
    if (stats.atime) console.log(`atime (Accessed): ${stats.atime.toISOString()}`);
    
    // Check if birthtime equals mtime (indicates birthtime might not be reliable)
    if (stats.birthtime && stats.mtime) {
      const birthtimeEqualsModified = stats.birthtime.getTime() === stats.mtime.getTime();
      console.log(`\nbirthtime equals mtime: ${birthtimeEqualsModified}`);
    }
    
  } catch (error) {
    console.error(`Error getting file stats: ${error.message}`);
  }
}

// Test with a few different files
console.log('=== FILE STATS TEST ===');

// Test the current file
testFileStats(__filename);

// Test a recently modified file
testFileStats('/Users/mpstaton/code/lossless-monorepo/content/tooling/AI-Toolkit/Models/CPM-Series.md');

// Test an older file that should have a different creation date
testFileStats('/Users/mpstaton/code/lossless-monorepo/tidyverse/observers/templates/tooling.ts');

// Test a file we know has been modified
testFileStats('/Users/mpstaton/code/lossless-monorepo/tidyverse/observers/fileSystemObserver.ts');

console.log('\n=== TEST COMPLETE ===');
