/**
 * Citation Service
 * 
 * Processes citations in markdown files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { formatFrontmatter } from '../fileSystemObserver';

// Configuration for registry
const CONFIG = {
  registryPath: path.join(process.cwd(), '../../content/data/citation-registry.json'),
  hexPrefix: 'cite-',
  hexLength: 8
};

// Citation registry to track citations across files
interface CitationData {
  hexId: string;
  sourceText?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceAuthor?: string;
  dateCreated: string;
  dateUpdated: string;
  files: string[]; // Files where this citation appears
}

/**
 * Citation Registry class
 * Maintains a registry of all citations across files
 */
class CitationRegistry {
  private citations: Map<string, CitationData> = new Map();
  private registryPath: string;
  private static instance: CitationRegistry;
  
  /**
   * Get the singleton instance of CitationRegistry
   * @returns The CitationRegistry instance
   */
  public static getInstance(): CitationRegistry {
    if (!CitationRegistry.instance) {
      CitationRegistry.instance = new CitationRegistry();
    }
    return CitationRegistry.instance;
  }
  
  /**
   * Constructor for CitationRegistry
   * Initializes the registry file path
   */
  private constructor() {
    this.registryPath = CONFIG.registryPath;
  }
  
  /**
   * Add a new citation to the registry
   * @param hexId - The hexadecimal identifier for the citation
   * @param data - Citation data
   */
  addCitation(hexId: string, data: Partial<CitationData>): void {
    const existingCitation = this.citations.get(hexId);
    
    if (existingCitation) {
      // Update existing citation
      this.citations.set(hexId, {
        ...existingCitation,
        ...data,
        dateUpdated: new Date().toISOString()
      });
    } else {
      // Create new citation
      this.citations.set(hexId, {
        hexId,
        dateCreated: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        files: data.files || [],
        ...data
      });
    }
  }
  
  /**
   * Get citation data by hex ID
   * @param hexId - The hexadecimal identifier
   * @returns Citation data or undefined if not found
   */
  getCitation(hexId: string): CitationData | undefined {
    return this.citations.get(hexId);
  }
  
  /**
   * Update the list of files where a citation appears
   * @param hexId - The hexadecimal identifier
   * @param filePath - Path to the file
   */
  updateCitationFiles(hexId: string, filePath: string): void {
    const citation = this.citations.get(hexId);
    
    if (citation) {
      if (!citation.files.includes(filePath)) {
        citation.files.push(filePath);
        citation.dateUpdated = new Date().toISOString();
        this.citations.set(hexId, citation);
      }
    }
  }
  
  /**
   * Get all citations
   * @returns Map of all citations
   */
  getAllCitations(): Map<string, CitationData> {
    return this.citations;
  }
  
  /**
   * Save the citation registry to disk
   * @returns Promise that resolves when the registry is saved
   */
  async saveToDisk(): Promise<void> {
    try {
      // Convert Map to object for JSON serialization
      const citationsObject = Object.fromEntries(this.citations);
      
      // Write to file
      await fs.writeFile(
        this.registryPath,
        JSON.stringify(citationsObject, null, 2),
        'utf8'
      );
      
      console.log(`Citation registry saved to: ${this.registryPath}`);
    } catch (error) {
      console.error('Error saving citation registry:', error);
      throw error;
    }
  }
  
  /**
   * Load the citation registry from disk
   * @returns Promise that resolves when the registry is loaded
   */
  async loadFromDisk(): Promise<void> {
    try {
      // Check if registry file exists
      try {
        await fs.access(this.registryPath);
      } catch (error) {
        // File doesn't exist, create empty registry
        console.log('Citation registry file not found, creating new registry');
        this.citations = new Map();
        return;
      }
      
      // Read registry file
      const registryData = await fs.readFile(this.registryPath, 'utf8');
      
      // Parse JSON and convert to Map
      const citationsObject = JSON.parse(registryData);
      this.citations = new Map(Object.entries(citationsObject));
      
      console.log(`Loaded ${this.citations.size} citations from registry`);
    } catch (error) {
      console.error('Error loading citation registry:', error);
      // Start with empty registry in case of error
      this.citations = new Map();
    }
  }
}

/**
 * Extract frontmatter and body from a markdown file using regex
 * @param content The content of the markdown file
 * @returns The frontmatter and body
 */
function extractFrontmatterAndBody(content: string): { frontmatter: Record<string, any>; body: string } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  
  if (!frontmatterMatch) {
    return null;
  }
  
  try {
    const frontmatterStr = frontmatterMatch[1];
    const body = frontmatterMatch[2];
    
    // Parse frontmatter using regex, not YAML library
    const frontmatter: Record<string, any> = {};
    
    // Split by lines and process each line
    const lines = frontmatterStr.split('\n');
    
    // Track current array property being processed
    let currentArrayProperty: string | null = null;
    let arrayValues: any[] = [];
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Check if this is an array item
      if (line.startsWith('- ') && currentArrayProperty) {
        // Add to current array
        arrayValues.push(line.substring(2).trim());
        continue;
      }
      
      // If we were processing an array and now hit a new property, save the array
      if (currentArrayProperty && !line.startsWith('- ')) {
        frontmatter[currentArrayProperty] = arrayValues;
        currentArrayProperty = null;
        arrayValues = [];
      }
      
      // Check for key-value pair
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Check if this is the start of an array
        if (!value) {
          currentArrayProperty = key;
          arrayValues = [];
          continue;
        }
        
        // Handle different value types
        if (value === 'null' || value === '') {
          frontmatter[key] = null;
        } else if (value === 'true') {
          frontmatter[key] = true;
        } else if (value === 'false') {
          frontmatter[key] = false;
        } else if (!isNaN(Number(value)) && !value.startsWith('0')) {
          // Only convert to number if it doesn't start with 0 (to preserve things like versions)
          frontmatter[key] = value.includes('.') ? parseFloat(value) : parseInt(value);
        } else {
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
          }
          frontmatter[key] = value;
        }
      }
    }
    
    // Handle any remaining array
    if (currentArrayProperty) {
      frontmatter[currentArrayProperty] = arrayValues;
    }
    
    return {
      frontmatter,
      body
    };
  } catch (error) {
    console.error('Error parsing frontmatter:', error);
    return null;
  }
}

/**
 * Combine frontmatter and body into a markdown file
 * @param frontmatter The frontmatter
 * @param body The body
 * @returns The combined content
 */
function combineFrontmatterAndBody(frontmatter: Record<string, any>, body: string): string {
  if (!frontmatter) {
    return body;
  }
  
  // Use our custom formatFrontmatter function to generate YAML
  const frontmatterStr = formatFrontmatter(frontmatter);
  return `---\n${frontmatterStr}---\n\n${body}`;
}

/**
 * Generate a random hex ID of specified length
 * @param length - Length of the hex ID
 * @returns Random hex string
 */
function generateHexId(length: number = 6): string {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

/**
 * Detects and converts numeric citations to hex format
 * @param content - The markdown file content
 * @param registry - The citation registry instance
 * @returns Object containing updated content and conversion statistics
 */
function convertNumericCitationsToHex(
  content: string,
  registry: CitationRegistry
): {
  updatedContent: string;
  stats: {
    numericCitationsFound: number;
    conversionsPerformed: number;
    existingHexCitations: number;
  }
} {
  // Statistics to track
  const stats = {
    numericCitationsFound: 0,
    conversionsPerformed: 0,
    existingHexCitations: 0
  };
  
  // Track citation mappings (numeric to hex)
  const citationMappings: Record<string, string> = {};
  
  // Find all numeric citations [^1], [^2], etc.
  const numericCitationRegex = /\[\^(\d+)\]/g;
  const numericCitations = [...content.matchAll(numericCitationRegex)];
  
  stats.numericCitationsFound = numericCitations.length;
  
  // Find all existing hex citations [^a1b2c3]
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...content.matchAll(hexCitationRegex)];
  
  stats.existingHexCitations = hexCitations.length;
  
  // Extract citation texts for numeric citations
  const numericCitationTexts: Record<string, string> = {};
  numericCitations.forEach(match => {
    const numericId = match[1];
    const citationText = extractCitationText(content, numericId);
    if (citationText) {
      numericCitationTexts[numericId] = citationText;
    }
  });
  
  // Check if we already have citations with the same text in the registry
  const allCitations = registry.getAllCitations();
  const textToHexMap: Record<string, string> = {};
  
  // Build a map of citation text to hex ID
  allCitations.forEach((citation, hexId) => {
    if (citation.sourceText) {
      textToHexMap[citation.sourceText] = hexId;
    }
  });
  
  // Generate hex IDs for each numeric citation
  numericCitations.forEach(match => {
    const numericId = match[1];
    const fullMatch = match[0];
    const citationText = numericCitationTexts[numericId];
    
    // If we have the citation text, check if we already have a hex ID for it
    if (citationText && textToHexMap[citationText]) {
      // Reuse existing hex ID for the same citation text
      citationMappings[numericId] = textToHexMap[citationText];
      console.log(`Reusing existing hex ID ${textToHexMap[citationText]} for citation: ${citationText.substring(0, 30)}...`);
    } else if (!citationMappings[numericId]) {
      // Generate a new hex ID if we don't have one yet
      citationMappings[numericId] = generateHexId();
      console.log(`Generated new hex ID ${citationMappings[numericId]} for citation ${numericId}`);
      
      // Add to our text-to-hex map for future reference
      if (citationText) {
        textToHexMap[citationText] = citationMappings[numericId];
      }
    }
    
    stats.conversionsPerformed++;
  });
  
  // Replace all numeric citations with hex citations
  let updatedContent = content;
  
  // First replace all citation references [^1] -> [^a1b2c3]
  Object.entries(citationMappings).forEach(([numericId, hexId]) => {
    const numericRefRegex = new RegExp(`\\[\\^${numericId}\\]`, 'g');
    updatedContent = updatedContent.replace(numericRefRegex, `[^${hexId}]`);
  });
  
  // Then replace all citation definitions [^1]: -> [^a1b2c3]:
  Object.entries(citationMappings).forEach(([numericId, hexId]) => {
    const numericDefRegex = new RegExp(`\\[\\^${numericId}\\]:`, 'g');
    updatedContent = updatedContent.replace(numericDefRegex, `[^${hexId}]:`);
  });
  
  return {
    updatedContent,
    stats
  };
}

/**
 * Extract citation text from footnote definition
 * @param content - The markdown file content
 * @param hexId - The hexadecimal identifier
 * @returns Citation text or undefined if not found
 */
function extractCitationText(content: string, hexId: string): string | undefined {
  const citationDefRegex = new RegExp(`\\[\\^${hexId}\\]:\\s*(.+)`, 'i');
  const match = content.match(citationDefRegex);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  return undefined;
}

/**
 * Process citations in a Markdown file
 * @param content - The markdown file content
 * @param filePath - Path to the file
 * @returns Object with updated content and processing statistics
 */
export async function processCitations(
  content: string,
  filePath: string
): Promise<{
  updatedContent: string;
  changed: boolean;
  stats: {
    citationsConverted: number;
  }
}> {
  // Get citation registry
  const citationRegistry = CitationRegistry.getInstance();
  
  // Load existing registry
  await citationRegistry.loadFromDisk();
  
  // Extract frontmatter and body
  const frontmatterAndBody = extractFrontmatterAndBody(content);
  
  if (!frontmatterAndBody) {
    return {
      updatedContent: content,
      changed: false,
      stats: {
        citationsConverted: 0
      }
    };
  }
  
  const { frontmatter, body } = frontmatterAndBody;
  
  // Convert numeric citations to hex
  const { updatedContent: bodyWithHexCitations, stats: conversionStats } = 
    convertNumericCitationsToHex(body, citationRegistry);
  
  // Extract citation text for all hex citations and update registry
  const hexCitationRegex = /\[\^([0-9a-f]{6})\]/g;
  const hexCitations = [...bodyWithHexCitations.matchAll(hexCitationRegex)];
  
  hexCitations.forEach(match => {
    const hexId = match[1];
    const citationText = extractCitationText(bodyWithHexCitations, hexId);
    
    if (citationText) {
      citationRegistry.addCitation(hexId, {
        sourceText: citationText,
        files: [filePath]
      });
    }
    
    // Update citation registry with this file
    citationRegistry.updateCitationFiles(hexId, filePath);
  });
  
  // Update frontmatter with citation information
  const updatedFrontmatter = {
    ...frontmatter,
    date_modified: new Date().toISOString().split('T')[0]
  };
  
  // Combine frontmatter and body
  const finalContent = combineFrontmatterAndBody(
    updatedFrontmatter, 
    bodyWithHexCitations
  );
  
  // Save citation registry
  await citationRegistry.saveToDisk();
  
  return {
    updatedContent: finalContent,
    changed: finalContent !== content,
    stats: {
      citationsConverted: conversionStats.conversionsPerformed
    }
  };
}
