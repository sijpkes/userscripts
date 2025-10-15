// ==UserScript==
// @name         Canvas DesignPlus to Markdown
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Convert DesignPLUS HTML in Canvas to/from Markdown with custom markers, handling mixed and nested content.
// @author       Paul Sijpkes
// @match        https://*/courses/*/pages/*/edit
// @match        https://*/courses/*/discussion_topics/*/edit
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// @downloadURL  https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// ==/UserScript==

(function() {
    'use strict';

    // -------------------------------------------------------------------------
    // 1. CONSTANTS (XML-style Custom Tags)
    // -------------------------------------------------------------------------

    // Using angle brackets for custom tags to prevent conflicts with standard Markdown.
    const TAGS = {
        DESIGN_WRAPPER_START: '<DP-WRAPPER>',
        DESIGN_WRAPPER_END: '</DP-WRAPPER>',
        HEADER_START: '<HEADER>',
        HEADER_END: '</HEADER>',
        BLOCK_START: '<CONTENT-BLOCK>',
        BLOCK_END: '</CONTENT-BLOCK>',
        ACCORDION_START: '<ACCORDION>',
        ACCORDION_END: '</ACCORDION>',
        PANEL_GROUP_START: '<PANEL-GROUP>',
        PANEL_GROUP_END: '</PANEL-GROUP>',
        PANEL_HEADING_TAG: '<PANEL-HEADING>',
        PANEL_HEADING_END_TAG: '</PANEL-HEADING>',
        PANEL_CONTENT_START: '<PANEL-CONTENT>',
        PANEL_CONTENT_END: '</PANEL-CONTENT>',
        MODULE_PROGRESS_BAR: '<MODULE-PROGRESS-BAR>',
        // Standardized token that no longer needs special escaping due to the tag style change
        USER_SHORT_NAME_TOKEN: '[Current User Short Name]'
    };

    // New ICON Regex: Looks for <ICON fa fa-book-reader> followed by a heading
    const ICON_HEADER_RE = /^.*<ICON\s+([\w\s\-]+)>\s*#+\s*(.*)$/;

    // Basic Markdown regex (kept for simple inline formatting)
    const boldRe = /\*\*(.*?)\*\*/g;
    const italicRe = /\*(.*?)\*/g;

    // -------------------------------------------------------------------------
    // 2. UTILITY FUNCTIONS
    // -------------------------------------------------------------------------

    // Waits for the TinyMCE iframe to be ready
    function waitForIframe(callback) {
        const iframe = document.querySelector('iframe.mce-tinymce');
        if (iframe && iframe.contentDocument.body) {
            callback(iframe);
        } else {
            setTimeout(() => waitForIframe(callback), 100);
        }
    }

    // Function to handle the removal of empty paragraphs (including those with only <br>)
    function removeEmptyParagraphsWithNBSP(htmlString) {
        // 1. Remove <p> containing only &nbsp; or whitespace
        let cleaned = htmlString.replace(
            /<p[^>]*>(?:\s|&nbsp;|\u00A0|&#160;|&#xA0;)*<\/p>/gi,
            ''
        );
        // 2. Remove <p> containing only <br> (common editor artifact)
        cleaned = cleaned.replace(
            /<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi,
            ''
        );
        // 3. Compress consecutive newlines
        cleaned = cleaned.replace(/\n\s*\n/g, '\n');

        return cleaned;
    }

    // Converts an HTML List element (UL or OL) to Markdown
    function convertListToMarkdown(listEl) {
        let md = '';
        const listItems = Array.from(listEl.children);
        const isOrdered = listEl.tagName === 'OL';

        listItems.forEach((li, index) => {
            let prefix = isOrdered ? `${index + 1}. ` : '- ';
            // Recursively convert inner content, including nested lists
            let content = li.textContent.trim();
            md += `${prefix}${content}\n`;
        });
        return md;
    }
    
    // Simple HTML escaping (less critical now, but good practice)
    function encodeHtmlEntities(str) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    
    // -------------------------------------------------------------------------
    // 3. REFACTORED HTML -> MARKDOWN (DOM Traversal)
    // -------------------------------------------------------------------------

    /**
     * Converts the DesignPLUS HTML structure into the custom XML-style Markdown format.
     * Uses W3C DOM traversal methods instead of regex against HTML strings.
     * @param {HTMLElement} htmlElement - The root element to convert (e.g., document.body).
     * @returns {string} The custom XML-style Markdown string.
     */
    function convertToMarkdown(htmlElement) {
        let md = '';

        // Function to traverse and convert children recursively
        function processNode(node) {
            let nodeMd = '';

            // Check for the main DesignPLUS wrapper class
            if (node.classList && node.classList.contains('dp-wrapper')) {
                nodeMd += TAGS.DESIGN_WRAPPER_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.DESIGN_WRAPPER_END + '\n';
            }
            // Check for Content Block
            else if (node.classList && node.classList.contains('dp-content-block')) {
                nodeMd += TAGS.BLOCK_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.BLOCK_END + '\n';
            }
            // Check for Accordion Group
            else if (node.classList && node.classList.contains('dp-accordion-group')) {
                nodeMd += TAGS.ACCORDION_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.ACCORDION_END + '\n';
            }
            // Check for Accordion Panel (Heading and Content)
            else if (node.classList && node.classList.contains('dp-panel-group')) {
                nodeMd += TAGS.PANEL_GROUP_START + '\n';
                
                // Get heading (assumed to be the first direct child with dp-panel-heading class)
                const headingEl = node.querySelector('.dp-panel-heading');
                if (headingEl) {
                    const headingText = headingEl.textContent.trim();
                    nodeMd += `${TAGS.PANEL_HEADING_TAG}${headingText}${TAGS.PANEL_HEADING_END_TAG}\n`;
                }
                
                // Get content (assumed to be the first direct child with dp-panel-content class)
                const contentEl = node.querySelector('.dp-panel-content');
                if (contentEl) {
                    nodeMd += TAGS.PANEL_CONTENT_START + '\n';
                    // Process inner content recursively (paragraphs, lists, etc.)
                    Array.from(contentEl.children).forEach(child => {
                        nodeMd += processNode(child);
                    });
                    nodeMd += TAGS.PANEL_CONTENT_END + '\n';
                }
                nodeMd += TAGS.PANEL_GROUP_END + '\n';
            }
            // Check for lists (UL or OL)
            else if (node.tagName === 'UL' || node.tagName === 'OL') {
                nodeMd += convertListToMarkdown(node) + '\n';
            }
            // Check for Headings (H1-H6) - look for specific ICON structure
            else if (node.tagName.match(/^H[1-6]$/)) {
                let text = node.textContent.trim();
                const hLevel = node.tagName.substring(1);
                
                // Check if it contains an icon span (e.g., <span class="dps-icon">)
                const iconSpan = node.querySelector('.dps-icon');
                if (iconSpan) {
                    const iconClass = Array.from(iconSpan.classList).find(c => c.startsWith('fa-') || c.startsWith('ph-'));
                    if (iconClass) {
                        // Extract icon classes and text
                        const iconClasses = Array.from(iconSpan.classList).filter(c => c !== 'dps-icon').join(' ');
                        const contentText = node.textContent.trim();
                        
                        // Output in the custom icon format: <ICON fa fa-book-reader> ### Title
                        nodeMd += `<ICON ${iconClasses}> ${'#'.repeat(hLevel)} ${contentText}\n`;
                    }
                } else {
                     // Standard heading
                    nodeMd += `${'#'.repeat(hLevel)} ${text}\n`;
                }
            }
            // Check for Paragraphs (P)
            else if (node.tagName === 'P') {
                let text = node.innerHTML.trim();
                // Replace <strong> and <em> with Markdown equivalents
                text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
                text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
                
                // Preserve the custom token in its original HTML context
                text = text.replace(/<span class="dp-personalized-token dp-user-short-name-placeholder">\[Current User Short Name\]<\/span>/g, TAGS.USER_SHORT_NAME_TOKEN);

                // Ignore empty paragraphs after cleanup
                if (text && text !== '&nbsp;') {
                    nodeMd += text + '\n';
                }
            }
            // Handle other elements (like images, tables, divs not caught above)
            else if (node.nodeType === Node.ELEMENT_NODE) {
                 // For all other elements, just process their children recursively
                 Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                 });
            }

            return nodeMd;
        }

        // Start processing from the editor body (iframe.contentDocument.body)
        const editorBody = htmlElement.contentDocument.body;
        
        // Find the main wrapper or process all children if wrapper is missing
        const wrapper = editorBody.querySelector('.dp-wrapper');
        
        if (wrapper) {
            md = processNode(wrapper);
        } else {
            // If no wrapper is found, process all body children (less ideal, but robust)
            Array.from(editorBody.children).forEach(child => {
                md += processNode(child);
            });
        }
        
        return md;
    }

    // -------------------------------------------------------------------------
    // 4. REFACTORED MARKDOWN -> HTML (DOMParser)
    // -------------------------------------------------------------------------

    /**
     * Converts the custom XML-style Markdown (using DOMParser) into the final HTML structure.
     * Uses W3C DOM traversal methods on the parsed XML tree.
     * @param {string} markdownContent - The custom XML-style Markdown string.
     * @returns {string} The final DesignPLUS HTML string.
     */
    function parseDesignPlusMarkdownToHTML(markdownContent) {
        let finalHtml = '';

        // 1. Wrap in a root element for valid XML parsing
        const xmlString = `<ROOT>${markdownContent}</ROOT>`;

        // 2. Use DOMParser to parse the string into an XML Document
        const parser = new DOMParser();
        // Parsing as 'text/xml' is stricter and handles custom tags well
        const doc = parser.parseFromString(xmlString, 'text/xml');

        // Check for parsing errors
        if (doc.querySelector('parsererror')) {
            console.error('XML Parsing Error. Check for unmatched custom tags.');
            // Fallback to simpler content if parsing fails completely
            return `<div class="dp-error-message">Error: Malformed Custom Tags. Check your XML tag balance.</div><p>${markdownContent.replace(/</g, '&lt;')}</p>`;
        }

        // Function to traverse the XML tree and build HTML recursively
        function buildHtml(xmlNode) {
            let html = '';

            // Handle the DP-WRAPPER structure
            if (xmlNode.tagName === 'DP-WRAPPER') {
                html += '<div class="dp-wrapper">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                // Adding an empty paragraph here, which the cleanup function will remove, 
                // but sometimes helps TinyMCE render blocks correctly.
                html += '<p>&nbsp;</p>\n</div>';
            }
            // Handle CONTENT-BLOCK
            else if (xmlNode.tagName === 'CONTENT-BLOCK') {
                html += '<div class="dp-content-block">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            // Handle ACCORDION structure (Accordion Group)
            else if (xmlNode.tagName === 'ACCORDION') {
                html += '<div class="dp-accordion-group">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            // Handle PANEL-GROUP (Container for a single panel)
            else if (xmlNode.tagName === 'PANEL-GROUP') {
                html += '<div class="dp-panel-group">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            // Handle PANEL-HEADING and PANEL-CONTENT
            else if (xmlNode.tagName === 'PANEL-HEADING') {
                // The content is the text inside the tag
                html += `<div class="dp-panel-heading"><p>${xmlNode.textContent.trim()}</p></div>\n`;
            }
            else if (xmlNode.tagName === 'PANEL-CONTENT') {
                html += '<div class="dp-panel-content">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            // Handle raw text nodes (non-tag content like paragraphs, lists, headings)
            else if (xmlNode.nodeType === Node.TEXT_NODE) {
                const lines = xmlNode.textContent.split('\n');

                lines.forEach(line => {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) return; // Skip empty/whitespace lines

                    // Check for ICON Headers (Regex still useful for single line patterns)
                    const iconMatch = trimmedLine.match(ICON_HEADER_RE);
                    if (iconMatch) {
                        const iconClasses = iconMatch[1]; // fa fa-book-reader
                        const headingContent = iconMatch[2].trim(); // ### Title
                        const hLevel = headingContent.match(/^(#+)\s*/);

                        if (hLevel) {
                            const level = hLevel[1].length;
                            const text = headingContent.substring(hLevel[0].length);
                            const iconHtml = `<span class="dps-icon ${iconClasses}" aria-hidden="true"></span>`;
                            html += `<h${level}>${iconHtml} ${text}</h${level}>\n`;
                        } else {
                             // Fallback if icon tag is used without a heading
                            html += `<p><span class="dps-icon ${iconClasses}" aria-hidden="true"></span> ${headingContent}</p>\n`;
                        }
                    } 
                    // Check for standard Markdown Headings
                    else if (trimmedLine.startsWith('#')) {
                        const headingMatch = trimmedLine.match(/^(#+)\s*(.*)$/);
                        if (headingMatch) {
                            const level = headingMatch[1].length;
                            const text = headingMatch[2];
                            html += `<h${level}>${text}</h${level}>\n`;
                        }
                    }
                    // Check for lists (Markdown syntax)
                    else if (trimmedLine.startsWith('- ') || trimmedLine.match(/^\d+\.\s/)) {
                        // For lists, we must re-parse them into UL/OL/LI structure
                        const listItems = [];
                        let isOrdered = trimmedLine.match(/^\d+\.\s/);
                        let listTag = isOrdered ? 'ol' : 'ul';
                        
                        // Simple single-level list reconstruction (can be improved)
                        listItems.push(trimmedLine.substring(trimmedLine.indexOf(' ') + 1));
                        
                        html += `<${listTag}><li>${listItems.join('</li><li>')}</li></${listTag}>\n`;
                    }
                    // All other plain text becomes a paragraph
                    else {
                        // Apply inline formatting and handle the custom token
                        let formatted = trimmedLine
                            .replace(boldRe, '<strong>$1</strong>')
                            .replace(italicRe, '<em>$1</em>')
                            // Replace the plain text token with the actual HTML span
                            .replace(TAGS.USER_SHORT_NAME_TOKEN, '<span class="dp-personalized-token dp-user-short-name-placeholder">[Current User Short Name]</span>');

                        html += `<p>${formatted}</p>\n`;
                    }
                });
            }

            return html;
        }

        // Start processing from the XML root element's children (skipping the temporary <ROOT> tag)
        Array.from(doc.documentElement.children).forEach(node => {
            finalHtml += buildHtml(node);
        });

        return finalHtml;
    }

    // -------------------------------------------------------------------------
    // 5. VALIDATION (Simplified)
    // -------------------------------------------------------------------------

    /**
     * Validates the custom XML-style Markdown for basic tag balance.
     * With DOMParser, this is mostly a sanity check. Unbalanced tags will cause a parser error.
     */
    function validateMDSyntax(markdownContent) {
        const doc = (new DOMParser()).parseFromString(`<ROOT>${markdownContent}</ROOT>`, 'text/xml');
        
        if (doc.querySelector('parsererror')) {
             // The parser itself is the best validator for tag balance
             alert("Validation Failed: Check your custom XML tag balance. (e.g., is every <CONTENT-BLOCK> closed with a </CONTENT-BLOCK>?)");
             return false;
        }
        return true;
    }


    // -------------------------------------------------------------------------
    // 6. UI AND EVENT HANDLERS
    // -------------------------------------------------------------------------

    function uploadMarkdownFile(callback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md, .txt';

        input.addEventListener('change', e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = () => callback(reader.result);
            reader.readAsText(file);
        });
        input.click();
    }

    // Initialize UI on page load
    window.onload = function() {
        const editorToolbar = document.querySelector('.mce-toolbar-grp');
        if (!editorToolbar) return; // Only run on pages with the editor

        // Create the main menu container
        const menu = document.createElement('div');
        menu.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border: 1px solid #ccc; padding: 20px; z-index: 10000; box-shadow: 0 4px 8px rgba(0,0,0,0.2); border-radius: 8px; display: none;';
        document.body.appendChild(menu);

        // Add options
        const title = document.createElement('h3');
        title.textContent = 'DesignPLUS Content Utility';
        menu.appendChild(title);

        // Option 1: HTML to Markdown (Extraction)
        const option1 = document.createElement('button');
        option1.textContent = 'Extract HTML to Markdown';
        option1.style.cssText = 'display: block; width: 100%; padding: 10px; margin: 10px 0; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;';
        option1.onclick = () => {
            waitForIframe(iframe => {
                const markdownContent = convertToMarkdown(iframe);
                
                // Trigger download
                const blob = new Blob([markdownContent], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'designplus_content.md';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                alert('Content extracted and download started. Markdown uses XML-style tags (<TAG>).');
                menu.style.display = 'none';
            });
        };
        menu.appendChild(option1);

        // Option 2: Markdown to HTML (Insertion)
        const option2 = document.createElement('button');
        option2.textContent = 'Upload Markdown to HTML';
        option2.style.cssText = 'display: block; width: 100%; padding: 10px; margin: 10px 0; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;';
        option2.onclick = () => {
            uploadMarkdownFile(md => {
                // Validation before conversion
                if (!validateMDSyntax(md)) return false; 
                
                // 1. Convert Markdown (XML-like) to raw HTML
                const preHtml = parseDesignPlusMarkdownToHTML(md);
                
                // 2. Cleanup empty paragraphs and whitespace created by parsing
                const finalHtml = removeEmptyParagraphsWithNBSP(preHtml);

                // 3. Insert into the iframe
                waitForIframe(iframe => {
                    iframe.contentDocument.body.innerHTML = finalHtml;
                    menu.style.display = 'none';
                });
            });
        };
        menu.appendChild(option2);
        
        // Close Button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'display: block; width: 100%; padding: 8px; margin-top: 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;';
        closeBtn.onclick = () => { menu.style.display = 'none'; };
        menu.appendChild(closeBtn);
        

        // Add the menu trigger button to the editor toolbar
        const trigger = document.createElement('button');
        trigger.textContent = 'DP Tools';
        trigger.style.cssText = 'background: #ffc107; color: #333; border: 1px solid #d39e00; padding: 5px 10px; margin-left: 10px; border-radius: 4px; cursor: pointer; font-weight: bold;';
        trigger.onclick = () => { menu.style.display = 'block'; };

        const toolbarGroup = editorToolbar.querySelector('.mce-container-body');
        if (toolbarGroup) {
            toolbarGroup.appendChild(trigger);
        }
    };
})();

