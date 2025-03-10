// Enhanced Claude Knowledge Base Exporter Content Script

class ClaudeKnowledgeBaseExporter {
  constructor() {
    this.pageObserver = null;
    this.debugMode = true;
  }

  // Logging method with configurable verbosity
  log(message, level = 'info') {
    if (!this.debugMode && level === 'debug') return;

    const levels = {
      error: console.error,
      warn: console.warn,
      info: console.log,
      debug: console.log
    };

    const colorStyles = {
      error: 'color: red; font-weight: bold',
      warn: 'color: orange',
      info: 'color: blue',
      debug: 'color: gray'
    };

    const logMethod = levels[level] || console.log;
    logMethod(`%c[Claude KB Exporter] ${message}`, colorStyles[level]);
  }

  // Enhanced debounce method
  debounce(func, wait) {
    let timeout;
    return (...args) => {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  // Get the project name for the ZIP file
  getProjectName() {
    try {
      // Try to get the project name from the heading using XPath
      const projectNameXPath = "/html/body/div[2]/div/div/main/div[1]/div[1]/div[1]/h1/span";
      const projectNameResult = document.evaluate(
        projectNameXPath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      
      const projectNameElement = projectNameResult.singleNodeValue;
      
      if (projectNameElement) {
        const projectName = projectNameElement.textContent.trim();
        if (projectName) {
          // Convert to snake case
          return projectName
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w_]/g, '')
            .replace(/_+/g, '_');
        }
      }
      
      // Fallback: try other selectors
      const selectors = [
        'h1', 
        '[data-testid="project-title"]',
        '[role="heading"]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const projectName = element.textContent.trim();
          if (projectName) {
            return projectName
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^\w_]/g, '')
              .replace(/_+/g, '_');
          }
        }
      }
      
      // Extract from URL if all else fails
      const urlMatch = window.location.href.match(/\/project\/([^/]+)/);
      if (urlMatch && urlMatch[1]) {
        return `claude_project_${urlMatch[1].substring(0, 8)}`;
      }
    } catch (error) {
      this.log(`Error getting project name: ${error.message}`, 'warn');
    }
    
    // Default name if all methods fail
    return `claude_kb_export_${new Date().toISOString().split('T')[0]}`;
  }

  // Main export method
  async handleExport() {
    try {
      this.log('Export process started', 'info');
      
      // Get project name for the zip file
      const projectName = this.getProjectName();
      this.log(`Exporting project: ${projectName}`, 'info');
      
      // Find document elements with multiple strategies
      let documentElements = this.findDocumentElements();
      
      if (documentElements.length === 0) {
        this.log('No documents found with primary selectors, trying fallback methods', 'info');
        documentElements = this.findDocumentElementsFallback();
        
        if (documentElements.length === 0) {
          throw new Error('No documents found to export');
        }
      }

      this.log(`Found ${documentElements.length} documents`, 'info');

      // Process documents sequentially to avoid popup handling issues
      const documents = [];
      
      for (let i = 0; i < documentElements.length; i++) {
        const element = documentElements[i];
        try {
          this.log(`Processing document ${i + 1}/${documentElements.length}`, 'debug');
          
          // Try to find the button that opens the document
          let documentButton = null;
          
          try {
            // Look for buttons within the list item
            const buttons = element.querySelectorAll('button');
            if (buttons.length > 0) {
              // If multiple buttons, prefer ones with text like "Open" or "View"
              for (const button of buttons) {
                const buttonText = button.textContent.toLowerCase();
                if (buttonText.includes('open') || buttonText.includes('view') || buttonText.includes('edit')) {
                  documentButton = button;
                  break;
                }
              }
              
              // If no specific button found, use the first one
              if (!documentButton) {
                documentButton = buttons[0];
              }
            }
            
            // If no button found, try the specific XPath
            if (!documentButton) {
              const buttonXPath = ".//div[2]/button";
              const buttonResult = document.evaluate(
                buttonXPath,
                element,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
              );
              documentButton = buttonResult.singleNodeValue;
            }
          } catch (buttonError) {
            this.log(`Error finding button: ${buttonError.message}`, 'debug');
          }
          
          // If no button found, use the element itself
          if (!documentButton) {
            documentButton = element;
          }
          
          // Click to open the document
          documentButton.click();
          
          // Wait for the popup to appear
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Extract title and content
          const title = await this.extractDocumentTitle(element);
          const content = await this.extractDocumentContent(element);
          
          this.log(`Extracted document: ${title}`, 'debug');
          documents.push({ title, content });
          
          // Close the popup if possible (look for a close button)
          try {
            const closeButton = document.querySelector('div[role="dialog"] button[aria-label="Close"], .modal button.close, div[role="dialog"] button');
            if (closeButton) {
              closeButton.click();
              // Wait for popup to close
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (closeError) {
            this.log(`Error closing popup: ${closeError.message}`, 'debug');
            // Try pressing Escape key as fallback
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 }));
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (docError) {
          this.log(`Error processing document ${i}: ${docError.message}`, 'warn');
        }
      }

      // Filter out failed document extractions
      const validDocuments = documents.filter(doc => doc !== null && doc.title && doc.content);

      if (validDocuments.length === 0) {
        throw new Error('No valid documents could be extracted');
      }

      // Convert to markdown
      const markdownFiles = validDocuments.map(doc => 
        this.convertToMarkdown(doc)
      );

      // Send to background script for zip creation and download
      chrome.runtime.sendMessage({
        action: 'createAndDownloadZip',
        files: markdownFiles,
        projectName: projectName
      }, response => {
        if (chrome.runtime.lastError) {
          this.log(`Message passing error: ${chrome.runtime.lastError.message}`, 'error');
          this.downloadMarkdownFilesDirectly(markdownFiles, projectName);
          return;
        }
        
        this.log('Export process completed successfully', 'info');
      });

    } catch (error) {
      this.log(`Export failed: ${error.message}`, 'error');
      alert(`Export Error: ${error.message}`);
    }
  }

  // Fallback direct download method using JSZip
  downloadMarkdownFilesDirectly(files, projectName) {
    try {
      // Check if JSZip is available
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library not available for direct download');
      }
      
      const zip = new JSZip();
      
      // Add files to zip
      files.forEach(file => {
        zip.file(file.name, file.content);
      });
      
      // Generate and download ZIP
      zip.generateAsync({ type: 'blob' })
        .then(content => {
          const url = URL.createObjectURL(content);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${projectName || 'claude_export'}_${new Date().toISOString().split('T')[0]}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          this.log('Documents exported directly with JSZip', 'info');
        })
        .catch(error => {
          this.log(`Direct ZIP creation failed: ${error.message}`, 'error');
          alert('Failed to create ZIP file directly');
        });
    } catch (error) {
      this.log(`Direct download fallback failed: ${error.message}`, 'error');
      alert('Export failed. Try refreshing the page and trying again.');
    }
  }

  // Document element selection - primary methods
  findDocumentElements() {
    // First, try the exact XPath for document list items
    try {
      const listItemXPath = "/html/body/div[2]/div/div/main/div[2]/div/div/div[2]/ul/li";
      const result = document.evaluate(
        listItemXPath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      
      if (result && result.snapshotLength > 0) {
        const elements = [];
        for (let i = 0; i < result.snapshotLength; i++) {
          elements.push(result.snapshotItem(i));
        }
        
        this.log(`Found ${elements.length} documents using exact XPath`, 'info');
        return elements;
      }
    } catch (error) {
      this.log(`Error finding documents with exact XPath: ${error.message}`, 'debug');
    }
    
    // Try a more generic approach to find the list
    try {
      // Find the main content area
      const mainElement = document.querySelector('main');
      if (mainElement) {
        // Look for any list element within the main content
        const listElements = mainElement.querySelectorAll('ul, ol');
        
        for (const list of listElements) {
          const items = list.querySelectorAll('li');
          if (items.length > 0) {
            this.log(`Found ${items.length} documents in list`, 'info');
            return Array.from(items);
          }
        }
      }
    } catch (error) {
      this.log(`Error finding list elements: ${error.message}`, 'debug');
    }
    
    // Continue with other selectors if the XPath approach fails
    const claudeSelectors = [
      // Try specific Claude Knowledge Base selectors
      'ul > li', // Most basic list item selector
      'ol > li',
      '[data-testid="project-document-list"] li',
      '[data-testid="document-list"] li',
      '[data-testid="project-document-item"]',
      '[data-testid="document-list-item"]',
      '[role="list"] [role="listitem"]'
    ];

    for (const selector of claudeSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        
        if (elements && elements.length > 0) {
          this.log(`Found ${elements.length} documents using selector: ${selector}`, 'info');
          return Array.from(elements);
        }
      } catch (error) {
        this.log(`Error with selector ${selector}: ${error.message}`, 'debug');
      }
    }

    this.log('No document elements found with primary methods, will try fallbacks', 'warn');
    return [];
  }

  // Fallback document element selection for difficult cases
  findDocumentElementsFallback() {
    this.log('Attempting fallback document selection methods', 'debug');
    
    // Strategy 1: Look for elements with specific text patterns
    try {
      // Find divs that might contain document titles
      const elements = Array.from(document.querySelectorAll('div'))
        .filter(el => {
          const text = el.textContent.trim();
          // Look for div elements that have text but aren't too long (likely titles)
          return text.length > 0 && text.length < 200 && 
                 el.querySelectorAll('div, span').length < 5 &&
                 // Check if it has a click handler (interactive element)
                 (el.onclick || 
                  el.getAttribute('role') === 'button' || 
                  el.className.includes('click'));
        });
      
      if (elements.length > 0) {
        this.log(`Found ${elements.length} potential documents using text pattern matching`, 'debug');
        return elements;
      }
    } catch (error) {
      this.log(`Error in fallback strategy 1: ${error.message}`, 'debug');
    }
    
    // Strategy 2: Navigational approach - find the document list container
    try {
      // Look for containers that might be document lists
      const containers = Array.from(document.querySelectorAll('div[role="list"], ul, ol, div > div > div'))
        .filter(container => {
          // Check if container has child elements that look like list items
          const children = container.children;
          return children.length > 0 && 
                 Array.from(children).some(child => 
                   child.tagName === 'LI' || 
                   child.getAttribute('role') === 'listitem' ||
                   child.className.includes('item')
                 );
        });
      
      for (const container of containers) {
        // Get the direct children that look like list items
        const items = Array.from(container.children)
          .filter(child => 
            child.tagName === 'LI' || 
            child.getAttribute('role') === 'listitem' ||
            child.className.includes('item')
          );
        
        if (items.length > 0) {
          this.log(`Found ${items.length} potential documents in list container`, 'debug');
          return items;
        }
      }
    } catch (error) {
      this.log(`Error in fallback strategy 2: ${error.message}`, 'debug');
    }
    
    // Strategy 3: DOM structure-based approach
    try {
      const mainElement = document.querySelector('main');
      if (mainElement) {
        // Find all divs within main that have a consistent structure
        const potentialLists = Array.from(mainElement.querySelectorAll('div > div > div'))
          .filter(div => {
            const siblingCount = Array.from(div.parentNode.children)
              .filter(child => child.tagName === div.tagName).length;
            return siblingCount > 2; // If there are similar siblings, it might be a list
          });
        
        if (potentialLists.length > 0) {
          this.log(`Found ${potentialLists.length} potential documents using DOM structure analysis`, 'debug');
          return potentialLists;
        }
      }
    } catch (error) {
      this.log(`Error in fallback strategy 3: ${error.message}`, 'debug');
    }
    
    this.log('No documents found even with fallback strategies', 'error');
    return [];
  }

  // Title extraction with multiple fallbacks
  async extractDocumentTitle(element) {
    // First try to get title from the popup header using XPath
    try {
      // We need to wait briefly for the popup to open after click
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get title from the popup header using XPath
      const titleXPath = "/html/body/div[4]/div/div/div[1]/h2";
      const titleResult = document.evaluate(
        titleXPath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      
      const titleElement = titleResult.singleNodeValue;
      
      if (titleElement) {
        const title = titleElement.textContent.trim();
        if (title) {
          this.log(`Found title in popup header: ${title}`, 'debug');
          return title;
        }
      }
    } catch (error) {
      this.log(`Error finding title with XPath: ${error.message}`, 'debug');
    }
    
    // Try various selectors for title elements as fallbacks
    const titleSelectors = [
      '[data-testid="document-title"]',
      '[data-testid="title"]',
      '[role="heading"]',
      'h1', 'h2', 'h3',
      '.title',
      'span.font-bold',
      'div[style*="font-weight: bold"]'
    ];

    // Try each selector
    for (const selector of titleSelectors) {
      try {
        const titleElement = element.querySelector(selector);
        if (titleElement) {
          const title = titleElement.textContent.trim();
          if (title) {
            this.log(`Found title using selector ${selector}: ${title}`, 'debug');
            return title;
          }
        }
      } catch (error) {
        this.log(`Error finding title with selector ${selector}: ${error.message}`, 'debug');
      }
    }

    // If no title element found, try to extract from the element itself
    try {
      // First, try to find the first text node that's not empty
      const textNodes = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      
      if (textNodes.length > 0) {
        const text = textNodes[0].textContent.trim();
        if (text) {
          this.log(`Extracted title from text node: ${text}`, 'debug');
          return text;
        }
      }
      
      // Then try the element's own text content
      const text = element.textContent.trim();
      if (text) {
        // Limit to first 50 chars
        const shortenedText = text.length > 50 ? text.substring(0, 47) + '...' : text;
        this.log(`Using element's text content as title: ${shortenedText}`, 'debug');
        return shortenedText;
      }
    } catch (error) {
      this.log(`Error extracting title from element text: ${error.message}`, 'debug');
    }

    // If all else fails, generate a generic title
    const fallbackTitle = `Document ${new Date().toISOString()}`;
    this.log(`Using fallback title: ${fallbackTitle}`, 'debug');
    return fallbackTitle;
  }

  // Content extraction with click handling
  async extractDocumentContent(element) {
    try {
      // Find the correct button to click using the provided XPath or a more generic approach
      let documentButton = null;
      
      try {
        // Try to find the button using the specific XPath
        const buttonXPath = "//div[2]/div/div/main/div[2]/div/div/div[2]/ul/li/div/div[2]/div/div[1]/div[2]/button";
        const result = document.evaluate(
          buttonXPath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        
        if (result.snapshotLength > 0) {
          // If multiple buttons found, use the one closest to our element
          let closestButton = null;
          let closestDistance = Infinity;
          
          for (let i = 0; i < result.snapshotLength; i++) {
            const button = result.snapshotItem(i);
            if (element.contains(button) || button.contains(element)) {
              documentButton = button;
              break;
            }
            
            // Calculate approximate distance between elements
            const buttonRect = button.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const distance = Math.sqrt(
              Math.pow(buttonRect.left - elementRect.left, 2) + 
              Math.pow(buttonRect.top - elementRect.top, 2)
            );
            
            if (distance < closestDistance) {
              closestDistance = distance;
              closestButton = button;
            }
          }
          
          if (!documentButton && closestButton) {
            documentButton = closestButton;
          }
        }
      } catch (xpathError) {
        this.log(`Error finding button with XPath: ${xpathError.message}`, 'debug');
      }
      
      // If XPath approach failed, try to find any button within the element
      if (!documentButton) {
        documentButton = element.querySelector('button') || element;
      }
      
      this.log('Clicking to open document popup', 'debug');
      documentButton.click();
      
      // Wait for popup to appear
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Get content using the specific XPath for the content area
      const contentXPath = "/html/body/div[4]/div/div/div[2]";
      const contentResult = document.evaluate(
        contentXPath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      
      const contentElement = contentResult.singleNodeValue;
      
      if (contentElement) {
        this.log('Found content element using specific XPath', 'debug');
        
        // Get the full text content
        const content = contentElement.textContent.trim();
        if (content) {
          this.log('Successfully extracted content', 'debug');
          return content;
        }
      }
      
      // Fallback: try to find text nodes directly using the provided XPath
      try {
        const textXPath = "/html/body/div[4]/div/div/div[2]/text()";
        const textResult = document.evaluate(
          textXPath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        
        if (textResult.snapshotLength > 0) {
          let fullText = '';
          for (let i = 0; i < textResult.snapshotLength; i++) {
            fullText += textResult.snapshotItem(i).textContent;
          }
          
          if (fullText.trim()) {
            this.log('Extracted content from text nodes', 'debug');
            return fullText.trim();
          }
        }
      } catch (textXPathError) {
        this.log(`Error extracting text nodes: ${textXPathError.message}`, 'debug');
      }
      
      // If the specific XPath approach fails, try more generic selectors
      this.log('Specific XPath failed, trying generic popup content selectors', 'debug');
      
      const modalElement = document.querySelector('div[role="dialog"], .modal, .popup');
      if (modalElement) {
        // Get all text within the modal, but exclude the title section
        const titleElement = modalElement.querySelector('h1, h2, h3, [role="heading"]');
        if (titleElement) {
          // Create a clone of the modal without the title
          const clone = modalElement.cloneNode(true);
          const clonedTitle = clone.querySelector('h1, h2, h3, [role="heading"]');
          if (clonedTitle && clonedTitle.parentNode) {
            clonedTitle.parentNode.removeChild(clonedTitle);
          }
          
          const content = clone.textContent.trim();
          if (content) {
            this.log('Extracted content from modal (excluding title)', 'debug');
            return content;
          }
        }
        
        // If title removal approach didn't work, just get all text
        const content = modalElement.textContent.trim();
        if (content) {
          this.log('Extracted raw content from modal', 'debug');
          return content;
        }
      }
      
      // Last resort fallback
      this.log('Could not extract content with any method', 'warn');
      return element.textContent.trim() || 'No content could be extracted';
      
    } catch (error) {
      this.log(`Error extracting content: ${error.message}`, 'warn');
      return 'Error extracting content: ' + error.message;
    }
  }

  // Markdown conversion
  convertToMarkdown(document) {
    try {
      // Get content that may be HTML or text
      let cleanContent = document.content;
      
      // Check if the content is HTML (contains HTML tags)
      if (cleanContent.includes('<') && cleanContent.includes('>')) {
        // Simple HTML to text conversion for common elements
        this.log('Content appears to be HTML, converting to markdown', 'debug');
        
        // This is a simple conversion that preserves the text content
        // Remove HTML tags while preserving line breaks
        cleanContent = cleanContent
          .replace(/<(p|div|h\d|br)[^>]*>/gi, '')  // Remove opening tags
          .replace(/<\/(p|div|h\d)>/gi, '\n\n')    // Replace closing tags with new lines
          .replace(/<br\s*\/?>/gi, '\n')           // Replace <br> with new lines
          .replace(/<[^>]*>/g, '')                 // Remove all other HTML tags
          .replace(/\n{3,}/g, '\n\n')              // Normalize excessive newlines
          .trim();
      }
      
      // Create markdown with frontmatter
      const markdownContent = `---
title: "${document.title.replace(/"/g, '\\"')}"
date: "${new Date().toISOString()}"
---

${cleanContent}`;

      // Sanitize filename - replace problematic characters
      const sanitizedFilename = document.title
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .trim()
        .substring(0, 100) + '.md';

      return {
        name: sanitizedFilename,
        content: markdownContent
      };
    } catch (error) {
      this.log(`Error converting to markdown: ${error.message}`, 'warn');
      // Create a fallback markdown file
      return {
        name: `document_${Date.now()}.md`,
        content: document.content || 'Empty document'
      };
    }
  }

  // Add export button with more robust target finding
  addExportButton() {
    // Check if button already exists
    if (document.querySelector('.claude-obsidian-export-btn')) {
      return;
    }

    // Try to find a good target button or location
    const targetStrategies = [
      // XPath approach
      () => document.evaluate(
        "/html/body/div[2]/div/div/main/div[2]/div/div/div[1]/button", 
        document, 
        null, 
        XPathResult.FIRST_ORDERED_NODE_TYPE, 
        null
      ).singleNodeValue,
      
      // Query selector approaches
      () => document.querySelector('[data-testid="project-header"] button'),
      () => document.querySelector('main header button'),
      () => document.querySelector('main nav button'),
      
      // General button in the header area
      () => {
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter(button => {
            const rect = button.getBoundingClientRect();
            return rect.top < 100; // Likely in the header
          });
        return buttons.length > 0 ? buttons[0] : null;
      }
    ];

    // Try each strategy to find a target
    let targetButton = null;
    for (const strategy of targetStrategies) {
      try {
        targetButton = strategy();
        if (targetButton) {
          this.log(`Found target button using strategy ${strategy.name || 'anonymous'}`, 'debug');
          break;
        }
      } catch (error) {
        this.log(`Error in button target strategy: ${error.message}`, 'debug');
      }
    }

    if (!targetButton) {
      this.log('Could not find target button, creating floating button', 'warn');
      // Create a floating button if no target is found
      const floatingButton = document.createElement('button');
      floatingButton.textContent = 'Export to Obsidian';
      floatingButton.className = 'claude-obsidian-export-btn';
      floatingButton.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        padding: 10px 15px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      `;

      floatingButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleExport();
      });

      document.body.appendChild(floatingButton);
      this.log('Added floating export button', 'info');
      return;
    }

    // Create normal export button
    const exportButton = document.createElement('button');
    exportButton.textContent = 'Export to Obsidian';
    exportButton.className = 'claude-obsidian-export-btn';
    exportButton.style.cssText = `
      margin-left: 10px;
      padding: 5px 10px;
      background-color: #4CAF50;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      height: ${targetButton.offsetHeight || 30}px;
      vertical-align: middle;
    `;

    exportButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleExport();
    });

    // Insert the button
    targetButton.parentNode.insertBefore(exportButton, targetButton.nextSibling);
    this.log('Export button added successfully', 'info');
  }

  // Page detection
  isKnowledgeBasePage() {
    const detectionStrategies = [
      // URL-based detection - ANY project URL
      () => window.location.href.includes('claude.ai/project/'),
      
      // Element-based detection
      () => !!document.querySelector('[data-testid="project-document-list"]'),
      () => !!document.querySelector('[role="list"] [role="listitem"]'),
      
      // Title-based detection
      () => {
        const title = document.title.toLowerCase();
        return title.includes('knowledge') || 
               title.includes('document') || 
               title.includes('project');
      }
    ];

    // Try each strategy
    for (const strategy of detectionStrategies) {
      try {
        if (strategy()) {
          return true;
        }
      } catch (error) {
        this.log(`Error in page detection strategy: ${error.message}`, 'debug');
      }
    }

    return false;
  }

  // Initialize extension
  initialize() {
    this.log('Claude Knowledge Base Exporter initializing', 'info');

    // Clean up existing observer
    if (this.pageObserver) {
      this.pageObserver.disconnect();
    }

    // Create new observer with enhanced detection
    this.pageObserver = new MutationObserver(
      this.debounce(() => {
        if (this.isKnowledgeBasePage()) {
          this.addExportButton();
        }
      }, 1000)
    );

    this.pageObserver.observe(document.body, { 
      subtree: true, 
      childList: true 
    });

    // Initial check
    if (this.isKnowledgeBasePage()) {
      this.addExportButton();
    }
  }
}

// Instantiate and initialize
const exporter = new ClaudeKnowledgeBaseExporter();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  try {
    exporter.initialize();
  } catch (error) {
    console.error('Initialization failed:', error);
  }
});

// Also run initialize immediately
try {
  exporter.initialize();
} catch (error) {
  console.error('Immediate initialization failed:', error);
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'triggerExport') {
    try {
      exporter.handleExport();
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});