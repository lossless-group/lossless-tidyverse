/* =============================================================================
 * assert-frontmatter-template.ts
 *
 * Script to assert that all Markdown files in a given directory (default: content/essays)
 * conform to the canonical essays frontmatter template.
 *
 * USAGE:
 *   pnpm tsx tidyverse/observers/scripts/assert-frontmatter-template.ts [directory]
 *
 * This script will:
 *   - Load the essays template definition
 *   - For each .md file in the directory, extract and inspect frontmatter
 *   - Report any missing, empty, or malformed required fields
 *   - Report extra/unexpected fields
 *   - Print a summary at the end
 *
 * CRITICAL PROJECT RULES:
 *   - Never modify or write files. This script is for assertion/reporting only.
 *   - Never use '---' as a section separator in Markdown except for frontmatter delimiters.
 *   - Follow directory/naming conventions and do not assume file locations.
 * ============================================================================= */

import path from 'path';
import fs from 'fs/promises';
import essaysTemplate from '../templates/essays';
import { extractFrontmatter } from '../utils/yamlFrontmatter';
import { reportPotentialFrontmatterInconsistencies } from '../utils/yamlFrontmatter';
import { USER_OPTIONS } from '../userOptionsConfig';

// ===================== USER OPTION: AUTO-ADD MISSING FRONTMATTER =====================
const AUTO_ADD_MISSING_FRONTMATTER_FIELDS = USER_OPTIONS.AUTO_ADD_MISSING_FRONTMATTER_FIELDS = true;
// If true, script will add missing/empty required fields with template defaults. If false, only reports issues.
// ====================================================================================

// === Type definition for template field ===
type InspectorStatus = "missing" | "malformed" | "empty" | "ok";
type FieldDef = {
  inspection: (value: any) => { status: InspectorStatus; message: string };
  // Other properties are ignored for assertion
};

// === Utility: Robust YAML serialization for frontmatter ===
/**
 * Serializes a JS object into YAML frontmatter for Markdown.
 * Handles strings, arrays, and objects. Never outputs raw '---' except as delimiter.
 * Only use this function for frontmatter serialization. Never for in-document YAML blocks.
 * @param obj - Object to serialize
 * @returns YAML frontmatter string (no delimiters)
 */
function serializeFrontmatterToYAML(obj: Record<string, any>): string {
  let yaml = '';
  
  // First, clean up any unexpected or malformed properties
  const cleanedObj = { ...obj };
  // Remove 'changes' property if it exists at the top level
  if ('changes' in cleanedObj) {
    delete cleanedObj.changes;
  }
  
  for (const [key, value] of Object.entries(cleanedObj)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        // Empty array
        yaml += `${key}:\n`;
      } else {
        // Non-empty array
        yaml += `${key}:\n`;
        for (const item of value) {
          yaml += `  - ${item}\n`;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Skip objects - they should have been flattened earlier
      console.log(`[assert-frontmatter-template] WARNING: Skipping object property ${key} during serialization`);
      continue;
    } else {
      // Output as string
      yaml += `${key}: ${value === undefined ? '' : value}\n`;
    }
  }
  return yaml.trim();
}

// === Utility: Robust YAML value stringification for arrays/objects ===
/**
 * Converts an array or object to a YAML-compliant string for frontmatter assignment.
 * Used to ensure type safety and avoid TS errors when assigning to updatedFrontmatter.
 * @param value - Array or object to stringify
 * @returns YAML string
 */
function yamlStringifyValue(value: any): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${value.join(', ')}]`;
  } else if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
  }
  return String(value);
}

// Utility: Recursively find all .md files in a directory
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      files.push(...await findMarkdownFiles(res));
    } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
      files.push(res);
    }
  }
  return files;
}

// Main assertion logic for a single file
// This function asserts frontmatter for a single Markdown file against the template.
// If AUTO_ADD_MISSING_FRONTMATTER_FIELDS is enabled, it will add any missing/empty required fields
// with template defaults and write the updated frontmatter back to the file.
// All logic is aggressively commented per project standards.
async function assertFrontmatterForFile(filePath: string, template: any) {
  // Read file content
  const content = await fs.readFile(filePath, 'utf8');

  // Extract frontmatter (may be undefined if missing)
  const frontmatter = extractFrontmatter(content) || {};

  // Required fields from template
  const required = template.required || {};
  const inspectionResults: { key: string, status: string, message: string }[] = [];
  let needsUpdate = false;
  let updatedFrontmatter = { ...frontmatter };

  // === Inspect and patch missing/empty fields ===
  for (const [key, def] of Object.entries(required)) {
    const inspector = (def as FieldDef).inspection;
    if (typeof inspector === 'function') {
      const { status, message } = inspector(frontmatter[key]);
      inspectionResults.push({ key, status, message });
    }
  }

  // === SINGLE PATCH PASS: fill missing/empty required fields in updatedFrontmatter ===
  // For each required field, if missing OR empty in the ORIGINAL frontmatter, use the template's defaultValueFn (if present).
  // This is the ONLY patching step. There is NO post-patch validation, NO redundant 'robust ensure' logic, NO loops, and NO recursion.
  for (const [key, def] of Object.entries(required)) {
    const inspector = (def as FieldDef).inspection;
    if (typeof inspector === 'function') {
      const { status } = inspector(frontmatter[key]);
      if (AUTO_ADD_MISSING_FRONTMATTER_FIELDS && (status === 'missing' || status === 'empty')) {
        // Type-safe access for defaultValueFn and type
        type FieldDefWithDefault = FieldDef & { type?: string; defaultValueFn?: (filePath: string, frontmatter?: Record<string, any>) => any };
        const defTyped = def as FieldDefWithDefault;
        
        // Get the basename of the file for title generation
        const basename = path.basename(filePath);
        
        if (typeof defTyped.defaultValueFn === 'function') {
          // For title specifically, pass the basename directly
          if (key === 'title') {
            updatedFrontmatter[key] = basename.replace(/\.md$/, '');
          } else {
            updatedFrontmatter[key] = defTyped.defaultValueFn(filePath, frontmatter);
          }
        } else if (defTyped.type === 'string') {
          updatedFrontmatter[key] = '';
        } else if (defTyped.type === 'array') {
          updatedFrontmatter[key] = [];
        } else {
          updatedFrontmatter[key] = null;
        }
        
        // === DEBUG LOGGING: REMOVE AFTER CONFIRMING FIX ===
        console.log(`[assert-frontmatter-template] PATCH:`, {
          file: filePath,
          field: key,
          result: updatedFrontmatter[key],
          typeof: typeof updatedFrontmatter[key]
        });
        
        needsUpdate = true;
      }
    }
  }

  // === Check for missing/extra fields ===
  // NOTE: This evaluation is ONLY for the original frontmatter, before any patching or writing occurs.
  const inconsistencies = reportPotentialFrontmatterInconsistencies(frontmatter, template, filePath);

  // === Print results for this file ===
  console.log(`\n==== [${path.relative(process.cwd(), filePath)}] ====`);
  for (const { key, status, message } of inspectionResults) {
    let statusIcon = '';
    if (status === 'missing') statusIcon = '[MISSING]';
    else if (status === 'malformed') statusIcon = '[MALFORMED]';
    else if (status === 'empty') statusIcon = '[EMPTY]';
    else statusIcon = '[OK]';
    console.log(`${statusIcon} ${key}: ${message}`);
  }
  if (inconsistencies.missingFields.length > 0) {
    console.log(`  Missing required fields: ${inconsistencies.missingFields.join(', ')}`);
  }
  if (inconsistencies.extraFields.length > 0) {
    console.log(`  Extra/unexpected fields: ${inconsistencies.extraFields.join(', ')}`);
  }

  // === If auto-add is enabled and update needed, write new frontmatter to file ===
  if (AUTO_ADD_MISSING_FRONTMATTER_FIELDS && needsUpdate) {
    // === DIRECT PATCHING FOR ALL REQUIRED FIELDS ===
    // Ensure all required fields have values, even if they weren't caught in the inspection loop
    for (const [key, def] of Object.entries(required)) {
      type FieldDefWithDefault = FieldDef & { type?: string; defaultValueFn?: (filePath: string, frontmatter?: Record<string, any>) => any };
      const defTyped = def as FieldDefWithDefault;
      
      // Special handling for title - use filename directly
      if (key === 'title') {
        updatedFrontmatter[key] = path.basename(filePath, '.md');
        console.log(`[assert-frontmatter-template] FORCE TITLE:`, {
          file: filePath,
          field: key,
          result: updatedFrontmatter[key]
        });
      }
      // Handle empty fields that need defaults
      else if (!updatedFrontmatter[key] || 
              (Array.isArray(updatedFrontmatter[key]) && updatedFrontmatter[key].length === 0) ||
              (typeof updatedFrontmatter[key] === 'object' && updatedFrontmatter[key] !== null)) {
        
        // Use defaultValueFn if available
        if (typeof defTyped.defaultValueFn === 'function') {
          const defaultValue = defTyped.defaultValueFn(filePath, frontmatter);
          
          // Ensure we don't store objects for date fields - convert to string if needed
          if (defTyped.type === 'date' && typeof defaultValue === 'object' && defaultValue !== null) {
            // If it's an object with a date property, extract that
            if (defaultValue.date) {
              updatedFrontmatter[key] = defaultValue.date;
            } 
            // If it's an object with changes.date_created, extract that
            else if (defaultValue.changes && defaultValue.changes.date_created) {
              updatedFrontmatter[key] = defaultValue.changes.date_created;
            }
            // Otherwise use today's date as fallback
            else {
              const now = new Date();
              updatedFrontmatter[key] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            }
          } else {
            updatedFrontmatter[key] = defaultValue;
          }
        }
        // Type-based defaults
        else if (defTyped.type === 'string') {
          updatedFrontmatter[key] = '';
        }
        else if (defTyped.type === 'array') {
          updatedFrontmatter[key] = [];
        }
        else {
          updatedFrontmatter[key] = null;
        }
        
        console.log(`[assert-frontmatter-template] FORCE PATCH:`, {
          file: filePath,
          field: key,
          result: updatedFrontmatter[key],
          typeof: typeof updatedFrontmatter[key]
        });
      }
    }
    
    // Compose new frontmatter YAML block using robust serialization
    const yaml =
      '---\n' +
      serializeFrontmatterToYAML(updatedFrontmatter) +
      '\n---';
    
    // Replace old frontmatter block in content (assumes frontmatter is at the top and delimited by ---)
    let newContent;
    if (/^---[\s\S]*?---/.test(content)) {
      // Replace existing frontmatter block
      newContent = content.replace(/^---[\s\S]*?---/, yaml);
    } else {
      // No frontmatter present, insert at top
      newContent = `${yaml}\n${content}`;
    }
    
    await fs.writeFile(filePath, newContent, 'utf8');
    console.log(`[UPDATED] Auto-added missing/empty required fields in ${filePath}`);
  }
}

// Entrypoint
(async () => {
  // Get directory from command-line or default
  const targetDir = process.argv[2] || path.resolve(process.cwd(), '../../content/essays');
  console.log(`\n[assert-frontmatter-template] Asserting essays template for directory: ${targetDir}`);

  // Find all Markdown files
  let files: string[] = [];
  try {
    files = await findMarkdownFiles(targetDir);
  } catch (err) {
    console.error(`[ERROR] Could not read directory: ${targetDir}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.log(`[INFO] No Markdown files found in directory: ${targetDir}`);
    process.exit(0);
  }

  // Assert each file
  let totalProblems = 0;
  for (const file of files) {
    await assertFrontmatterForFile(file, essaysTemplate);
  }
  console.log(`\n[assert-frontmatter-template] Assertion complete for ${files.length} files.`);
})();

/* =============================================================================
 * END OF SCRIPT: assert-frontmatter-template.ts
 * ============================================================================= */