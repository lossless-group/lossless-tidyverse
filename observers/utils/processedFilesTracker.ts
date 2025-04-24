/**
 * Processed Files Tracker
 * 
 * A centralized utility for tracking which files have been processed by the observer system.
 * This prevents infinite loops and duplicate processing while ensuring proper state management
 * across process restarts.
 * 
 * The tracker uses a singleton pattern to ensure there's only one instance tracking files
 * across the entire application, regardless of how many components access it.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Information about a processed file
 */
interface ProcessedFileInfo {
  // When the file was processed
  timestamp: number;
  // Optional content hash for detecting actual changes
  hash?: string;
}

/**
 * Singleton class for tracking processed files across the application
 */
class ProcessedFilesTracker {
  // Singleton instance
  private static instance: ProcessedFilesTracker;

  // Map to track processed files with timestamps
  private processedFiles = new Map<string, ProcessedFileInfo>();
  
  // Configurable expiration time (default: 5 minutes)
  private expirationMs = 5 * 60 * 1000;
  
  // File to persist processed state (optional)
  private stateFilePath: string;
  private persistStateToFile: boolean;
  
  // Critical files that should always be processed regardless of tracking
  private criticalFiles: string[] = [];
  
  // Flag to track if the tracker has been initialized
  private initialized = false;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Default state file path in the same directory as this module
    this.stateFilePath = path.join(__dirname, '.observer-state.json');
    this.persistStateToFile = process.env.PERSIST_OBSERVER_STATE === 'true';
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ProcessedFilesTracker {
    if (!ProcessedFilesTracker.instance) {
      ProcessedFilesTracker.instance = new ProcessedFilesTracker();
    }
    return ProcessedFilesTracker.instance;
  }

  /**
   * Initialize the tracker
   * @param options Configuration options
   */
  public initialize(options?: {
    expirationMs?: number;
    stateFilePath?: string;
    persistStateToFile?: boolean;
    criticalFiles?: string[];
  }): void {
    if (this.initialized) {
      console.log('[ProcessedFilesTracker] Already initialized, skipping');
      return;
    }

    // Apply options if provided
    if (options) {
      if (options.expirationMs) this.expirationMs = options.expirationMs;
      if (options.stateFilePath) this.stateFilePath = options.stateFilePath;
      if (options.persistStateToFile !== undefined) this.persistStateToFile = options.persistStateToFile;
      if (options.criticalFiles) this.criticalFiles = options.criticalFiles.map(f => f.toLowerCase());
    }

    console.log('[ProcessedFilesTracker] Initializing with the following configuration:');
    console.log(`  - Expiration time: ${this.expirationMs}ms`);
    console.log(`  - State file path: ${this.stateFilePath}`);
    console.log(`  - Persist state to file: ${this.persistStateToFile}`);
    console.log(`  - Critical files: ${this.criticalFiles.join(', ') || 'None'}`);

    // Reset the processed files set to ensure a clean start
    this.reset();

    // Load state from file if persistence is enabled
    if (this.persistStateToFile) {
      this.loadStateFromFile();
    }

    this.initialized = true;
    console.log('[ProcessedFilesTracker] Initialization complete');
  }

  /**
   * Reset the processed files tracking
   */
  public reset(): void {
    console.log('[ProcessedFilesTracker] Resetting processed files tracking');
    this.processedFiles.clear();
    console.log('[ProcessedFilesTracker] Processed files tracking reset complete. Set size: 0');
  }

  /**
   * Mark a file as processed
   * @param filePath Path to the file to mark as processed
   * @param generateHash Whether to generate a content hash for the file
   */
  public markAsProcessed(filePath: string, generateHash: boolean = false): void {
    console.log(`[ProcessedFilesTracker] Marking file as processed: ${filePath}`);
    
    // Special case: If filePath is 'RESET', reset the processed files set
    if (filePath === 'RESET') {
      console.log('[ProcessedFilesTracker] Received RESET signal');
      this.reset();
      return;
    }
    
    const fileInfo: ProcessedFileInfo = {
      timestamp: Date.now()
    };
    
    // Optionally generate a content hash to detect actual changes
    if (generateHash) {
      try {
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          fileInfo.hash = crypto.createHash('md5').update(fileContent).digest('hex');
          console.log(`[ProcessedFilesTracker] Generated content hash for ${filePath}: ${fileInfo.hash.substring(0, 8)}...`);
        } else {
          console.warn(`[ProcessedFilesTracker] Cannot generate hash for non-existent file: ${filePath}`);
        }
      } catch (error) {
        console.error(`[ProcessedFilesTracker] Error generating hash for ${filePath}:`, error);
      }
    }
    
    this.processedFiles.set(filePath, fileInfo);
    
    // Log periodically to avoid excessive output
    if (this.processedFiles.size % 10 === 0) {
      console.log(`[ProcessedFilesTracker] Total processed files: ${this.processedFiles.size}`);
    }

    // Persist state to file if enabled
    if (this.persistStateToFile) {
      this.saveStateToFile();
    }
  }

  /**
   * Check if a file should be processed
   * @param filePath Path to the file to check
   * @param forceProcess Force processing regardless of tracking status
   * @returns True if the file should be processed, false otherwise
   */
  public shouldProcess(filePath: string, forceProcess: boolean = false): boolean {
    // Always process if forced
    if (forceProcess) {
      console.log(`[ProcessedFilesTracker] Force processing requested for: ${filePath}`);
      return true;
    }
    
    // Check if file is in critical files list
    const fileName = path.basename(filePath).toLowerCase();
    if (this.criticalFiles.includes(fileName)) {
      console.log(`[ProcessedFilesTracker] Critical file detected: ${filePath}, will process`);
      return true;
    }
    
    // Check if file exists in processed set
    const fileInfo = this.processedFiles.get(filePath);
    if (!fileInfo) {
      return true; // File not processed before
    }
    
    // Check if the entry has expired
    const now = Date.now();
    if (now - fileInfo.timestamp > this.expirationMs) {
      console.log(`[ProcessedFilesTracker] Processing entry for ${filePath} has expired, will process again`);
      return true;
    }
    
    // If we have a hash, check if the content has changed
    if (fileInfo.hash) {
      try {
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const currentHash = crypto.createHash('md5').update(fileContent).digest('hex');
          
          if (currentHash !== fileInfo.hash) {
            console.log(`[ProcessedFilesTracker] Content hash changed for ${filePath}, will process`);
            return true;
          }
          
          console.log(`[ProcessedFilesTracker] Content hash unchanged for ${filePath}, skipping`);
        }
      } catch (error) {
        console.error(`[ProcessedFilesTracker] Error checking hash for ${filePath}:`, error);
        // If we can't check the hash, process the file to be safe
        return true;
      }
    }
    
    console.log(`[ProcessedFilesTracker] File ${filePath} was processed recently. Skipping.`);
    return false;
  }

  /**
   * Add a critical file that should always be processed
   * @param fileName Name of the file (without path)
   */
  public addCriticalFile(fileName: string): void {
    const normalizedName = fileName.toLowerCase();
    if (!this.criticalFiles.includes(normalizedName)) {
      this.criticalFiles.push(normalizedName);
      console.log(`[ProcessedFilesTracker] Added critical file: ${fileName}`);
    }
  }

  /**
   * Load state from file if persistence is enabled
   */
  private loadStateFromFile(): void {
    if (!this.persistStateToFile) {
      console.log('[ProcessedFilesTracker] State persistence is disabled, skipping state load');
      return;
    }

    try {
      console.log(`[ProcessedFilesTracker] Attempting to load state from: ${this.stateFilePath}`);
      
      if (!fs.existsSync(this.stateFilePath)) {
        console.log('[ProcessedFilesTracker] State file does not exist, starting with empty state');
        return;
      }
      
      // Check if file is readable
      try {
        fs.accessSync(this.stateFilePath, fs.constants.R_OK);
      } catch (accessError) {
        console.error(`[ProcessedFilesTracker] Cannot read state file: ${this.stateFilePath}`, accessError);
        return;
      }
      
      const data = fs.readFileSync(this.stateFilePath, 'utf8');
      if (!data || data.trim() === '') {
        console.log('[ProcessedFilesTracker] State file is empty, starting with empty state');
        return;
      }
      
      try {
        const state = JSON.parse(data);
        
        if (!state || typeof state !== 'object' || !state.processedFiles) {
          console.error('[ProcessedFilesTracker] Invalid state file format, starting with empty state');
          return;
        }
        
        // Convert the loaded state back to a Map
        this.processedFiles = new Map(Object.entries(state.processedFiles));
        
        // Validate and clean up loaded entries
        let invalidEntries = 0;
        for (const [filePath, info] of this.processedFiles.entries()) {
          if (!info || typeof info !== 'object' || typeof info.timestamp !== 'number') {
            this.processedFiles.delete(filePath);
            invalidEntries++;
          }
        }
        
        if (invalidEntries > 0) {
          console.warn(`[ProcessedFilesTracker] Removed ${invalidEntries} invalid entries from loaded state`);
        }
        
        console.log(`[ProcessedFilesTracker] Successfully loaded ${this.processedFiles.size} processed file entries from state file`);
      } catch (parseError) {
        console.error('[ProcessedFilesTracker] Error parsing state file JSON:', parseError);
      }
    } catch (error) {
      console.error('[ProcessedFilesTracker] Error loading state from file:', error);
      // Ensure we start with a clean state in case of errors
      this.processedFiles.clear();
      console.log('[ProcessedFilesTracker] Reset to empty state due to load error');
    }
  }

  /**
   * Save state to file if persistence is enabled
   */
  private saveStateToFile(): void {
    if (!this.persistStateToFile) {
      console.log('[ProcessedFilesTracker] State persistence is disabled, skipping state save');
      return;
    }

    try {
      console.log(`[ProcessedFilesTracker] Attempting to save state to: ${this.stateFilePath}`);
      
      // Ensure directory exists
      const stateFileDir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(stateFileDir)) {
        try {
          fs.mkdirSync(stateFileDir, { recursive: true });
          console.log(`[ProcessedFilesTracker] Created directory for state file: ${stateFileDir}`);
        } catch (mkdirError) {
          console.error(`[ProcessedFilesTracker] Failed to create directory for state file: ${stateFileDir}`, mkdirError);
          return;
        }
      }
      
      // Check if directory is writable
      try {
        fs.accessSync(stateFileDir, fs.constants.W_OK);
      } catch (accessError) {
        console.error(`[ProcessedFilesTracker] Cannot write to directory: ${stateFileDir}`, accessError);
        return;
      }
      
      // Convert Map to a plain object for JSON serialization
      const state = {
        processedFiles: Object.fromEntries(this.processedFiles),
        savedAt: new Date().toISOString(),
        version: '1.0'
      };
      
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
      console.log(`[ProcessedFilesTracker] Successfully saved ${this.processedFiles.size} processed file entries to state file`);
    } catch (error) {
      console.error('[ProcessedFilesTracker] Error saving state to file:', error);
    }
  }

  /**
   * Shutdown the tracker
   */
  public shutdown(): void {
    console.log('[ProcessedFilesTracker] Shutting down');
    
    // Log the number of processed files
    console.log(`[ProcessedFilesTracker] Number of processed files at shutdown: ${this.processedFiles.size}`);
    
    // Persist state to file if enabled
    if (this.persistStateToFile) {
      this.saveStateToFile();
    }
    
    // Reset the processed files set to ensure a clean state for the next run
    this.reset();
    
    console.log('[ProcessedFilesTracker] Shutdown complete');
  }

  /**
   * Get the current count of processed files
   */
  public getProcessedFilesCount(): number {
    return this.processedFiles.size;
  }
}

// Export singleton instance
export const processedFilesTracker = ProcessedFilesTracker.getInstance();

// Export convenience functions
export const initializeProcessedFilesTracker = (options?: {
  expirationMs?: number;
  stateFilePath?: string;
  persistStateToFile?: boolean;
  criticalFiles?: string[];
}) => processedFilesTracker.initialize(options);

export const markFileAsProcessed = (filePath: string, generateHash: boolean = false) => 
  processedFilesTracker.markAsProcessed(filePath, generateHash);

export const shouldProcessFile = (filePath: string, forceProcess: boolean = false) => 
  processedFilesTracker.shouldProcess(filePath, forceProcess);

export const resetProcessedFilesTracker = () => 
  processedFilesTracker.reset();

export const shutdownProcessedFilesTracker = () => 
  processedFilesTracker.shutdown();

export const addCriticalFile = (fileName: string) => 
  processedFilesTracker.addCriticalFile(fileName);
