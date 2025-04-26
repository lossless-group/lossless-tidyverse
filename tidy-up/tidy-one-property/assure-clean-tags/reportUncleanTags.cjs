const fs = require('fs').promises;
const path = require('path');
const { minimatch } = require('minimatch');

/**
 * Get the next available index for today's reports
 * @param {string} reportsDir - Directory containing reports
 * @param {string} reportBaseName - Base name of the report (e.g., 'Tag-Irregularities')
 * @returns {Promise<string>} - The next available index as a two-digit string
 */
async function generateDetectionOfUncleanTagsReport(reportsDir, reportBaseName) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const pattern = `${today}_${reportBaseName}_*.md`;
  
  try {
    const files = await fs.readdir(reportsDir);
    const todaysReports = files.filter(file => minimatch(file, pattern));
    
    if (todaysReports.length === 0) return '01';
    
    // Extract indices and find the highest
    const indices = todaysReports
      .map(file => parseInt(file.match(/_(\d{2})\.md$/)?.[1] || '0'))
      .filter(n => !isNaN(n));
    
    const nextIndex = Math.max(...indices) + 1;
    return nextIndex.toString().padStart(2, '0');
  } catch (error) {
    console.error('Error reading reports directory:', error);
    return '01';
  }
}

/**
 * Generate report content
 */
async function generateFixTagReport(results) {
  const reportsDir = path.join(__dirname, '../../../../content/reports');
  const reportBaseName = 'Tag-Irregularities';
  const nextIndex = await getNextReportIndex(reportsDir, reportBaseName);
  const timestamp = new Date().toISOString();
  const date = new Date().toISOString().split('T')[0];
  
  const reportFileName = `${date}_${reportBaseName}_${nextIndex}.md`;
  const reportPath = path.join(reportsDir, reportFileName);

  let content = `---
date: ${date}
datetime: ${timestamp}
authors: 
- Michael Staton
augmented_with: 'Windsurf on Claude 3.5 Sonnet'
category: Data-Integrity
tags:
- Documentation-Standards
- YAML
- Scripts
- Reports
- Prompts
---

# Tag Irregularities Report

## Summary
- Total files processed: ${results.totalFiles}
- Files with tag irregularities: ${results.irregularFiles.length}

## Files with Tag Irregularities
${results.irregularFiles.map(item => `
### ${path.relative(CONTENT_DIR, item.file)}
- Line: \`${item.line}\`
- Issues: ${item.issues.join(', ')}
`).join('\n')}
`;

  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(reportPath, content);
  
  console.log(`Report generated: ${reportPath}`);
  return reportPath;
}

module.exports = {
  generateDetectionOfUncleanTagsReport
};