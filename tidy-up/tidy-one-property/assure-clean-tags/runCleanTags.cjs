const path = require('path');
const { detectUncleanTags } = require('./detectUncleanTags.cjs');
const { cleanAllTags } = require('./cleanUncleanTags.cjs');
const { generateCleaningReport } = require('./reportCleaningOfTags.cjs');

// =============================================
// Configuration
// =============================================
const CONFIG = {
  // Directory to process (can be overridden via command line args)
  targetDir: process.argv[2] || path.join(__dirname, '../../../../content/changelog--code'),
  
  // Whether to create backup files before modifying
  createBackups: true,
  
  // Whether to generate reports
  generateReports: true,
  
  // Report base directory
  reportsDir: path.join(__dirname, '../../../../content/reports')
};

/**
 * Main pipeline for tag cleaning process
 * 1. Detect unclean tags
 * 2. Clean the tags
 * 3. Generate reports
 */
async function runTagCleaningPipeline() {
  try {
    console.log('Starting tag cleaning pipeline...');
    console.log(`Target directory: ${CONFIG.targetDir}`);
    
    // Step 1: Detection
    console.log('\n1. Detecting unclean tags...');
    const detectionResults = await detectUncleanTags(CONFIG.targetDir);
    
    if (detectionResults.irregularFiles.length === 0) {
      console.log('No unclean tags found. Pipeline complete.');
      return;
    }
    
    console.log(`Found ${detectionResults.irregularFiles.length} files with unclean tags.`);
    
    // Step 2: Cleaning
    console.log('\n2. Cleaning tags...');
    const cleaningResults = await cleanAllTags(
      detectionResults.irregularFiles.map(f => f.file),
      CONFIG
    );
    
    // Step 3: Reporting
    if (CONFIG.generateReports) {
      console.log('\n3. Generating reports...');
      const reportPath = await generateCleaningReport({
        title: 'Tag Cleaning Report',
        date: new Date().toISOString(),
        results: {
          detection: detectionResults,
          cleaning: cleaningResults
        }
      });
      console.log(`Report generated: ${reportPath}`);
    }
    
    console.log('\nPipeline complete!');
    console.log(`Total files processed: ${detectionResults.totalFiles}`);
    console.log(`Files cleaned: ${cleaningResults.filter(r => r.modified).length}`);
    
  } catch (error) {
    console.error('Pipeline failed:', error);
    process.exit(1);
  }
}

// Run the pipeline
runTagCleaningPipeline();