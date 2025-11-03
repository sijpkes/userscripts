// ==UserScript==
// @name         Canvas DesignPlus to Markdown
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Convert to or from DesignPLUS HTML in Canvas to or from Markdown with custom markers
// @author       Paul Sijpkes
// @match        https://*/courses/*/pages/*/edit
// @match        https://*/courses/*/discussion_topics/*/edit
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.meta.js
// @downloadURL  https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// ==/UserScript==

(function() {
    'use strict';

    // -------------------------------------------------------------------------
    // 1. CONSTANTS (XML-style Custom Tags)
    // -------------------------------------------------------------------------

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
        USER_SHORT_NAME_TOKEN: '[Current User Short Name]'
    };

    const ICON_HEADER_RE = /^.*<ICON\s+([\w\s\-]+)>\s*#+\s*(.*)$/;
    const boldRe = /\*\*(.*?)\*\*/g;
    const italicRe = /\*(.*?)\*/g;

    // -------------------------------------------------------------------------
    // 2. UTILITY FUNCTIONS
    // -------------------------------------------------------------------------

    function waitForIframe(callback, _tout) {
        // console.log('Waiting for TinyMCE iframe...');
        const iframe = document.getElementById('wiki_page_body_ifr');

        if (iframe && iframe.contentDocument.body) {
            clearTimeout(_tout)
            callback(iframe, null);
        } else {
            // Keep the timeout for iframe content access, as the iframe itself 
            // might load quickly, but its contentDocument takes time.
            const t = setTimeout(() => waitForIframe(callback, t), 100);
        }
    }

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

    function convertListToMarkdown(listEl) {
        let md = '';
        const listItems = Array.from(listEl.children);
        const isOrdered = listEl.tagName === 'OL';

        listItems.forEach((li, index) => {
            let prefix = isOrdered ? `${index + 1}. ` : '- ';
            // Recursively convert inner content, including nested lists (simplified to textContent)
            let content = li.textContent.trim();
            md += `${prefix}${content}\n`;
        });
        return md;
    }
    
    function encodeHtmlEntities(str) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    
    // -------------------------------------------------------------------------
    // 3. REFACTORED HTML -> MARKDOWN (DOM Traversal)
    // -------------------------------------------------------------------------

    function convertToMarkdown(htmlElement) {
        let md = '';

        function processNode(node) {
            let nodeMd = '';

            if (node.classList && node.classList.contains('dp-wrapper')) {
                nodeMd += TAGS.DESIGN_WRAPPER_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.DESIGN_WRAPPER_END + '\n';
            }
            else if (node.classList && node.classList.contains('dp-content-block')) {
                nodeMd += TAGS.BLOCK_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.BLOCK_END + '\n';
            }
            else if (node.classList && node.classList.contains('dp-accordion-group')) {
                nodeMd += TAGS.ACCORDION_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.ACCORDION_END + '\n';
            }
            else if (node.classList && node.classList.contains('dp-panel-group')) {
                nodeMd += TAGS.PANEL_GROUP_START + '\n';
                
                const headingEl = node.querySelector('.dp-panel-heading');
                if (headingEl) {
                    const headingText = headingEl.textContent.trim();
                    nodeMd += `${TAGS.PANEL_HEADING_TAG}${headingText}${TAGS.PANEL_HEADING_END_TAG}\n`;
                }
                
                const contentEl = node.querySelector('.dp-panel-content');
                if (contentEl) {
                    nodeMd += TAGS.PANEL_CONTENT_START + '\n';
                    Array.from(contentEl.children).forEach(child => {
                        nodeMd += processNode(child);
                    });
                    nodeMd += TAGS.PANEL_CONTENT_END + '\n';
                }
                nodeMd += TAGS.PANEL_GROUP_END + '\n';
            }
            else if (node.tagName === 'UL' || node.tagName === 'OL') {
                nodeMd += convertListToMarkdown(node) + '\n';
            }
            else if (node.tagName.match(/^H[1-6]$/)) {
                let text = node.textContent.trim();
                const hLevel = node.tagName.substring(1);
                
                const iconSpan = node.querySelector('.dps-icon');
                if (iconSpan) {
                    const iconClasses = Array.from(iconSpan.classList).filter(c => c !== 'dps-icon').join(' ');
                    const contentText = node.textContent.trim();
                    
                    nodeMd += `<ICON ${iconClasses}> ${'#'.repeat(hLevel)} ${contentText}\n`;
                } else {
                     // Standard heading
                    nodeMd += `${'#'.repeat(hLevel)} ${text}\n`;
                }
            }
            else if (node.tagName === 'P') {
                let text = node.innerHTML.trim();
                text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
                text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
                
                // Preserve the custom token 
                text = text.replace(/<span class="dp-personalized-token dp-user-short-name-placeholder">\[Current User Short Name\]<\/span>/g, TAGS.USER_SHORT_NAME_TOKEN);

                if (text && text !== '&nbsp;') {
                    nodeMd += text + '\n';
                }
            }
            else if (node.nodeType === Node.ELEMENT_NODE) {
                 Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                 });
            }

            return nodeMd;
        }

        const editorBody = htmlElement.contentDocument.body;
        const wrapper = editorBody.querySelector('.dp-wrapper');
        
        if (wrapper) {
            md = processNode(wrapper);
        } else {
            Array.from(editorBody.children).forEach(child => {
                md += processNode(child);
            });
        }
        
        return md;
    }

    // -------------------------------------------------------------------------
    // 4. REFACTORED MARKDOWN -> HTML (DOMParser)
    // -------------------------------------------------------------------------

    function parseDesignPlusMarkdownToHTML(markdownContent) {
        let finalHtml = '';
        const xmlString = `<ROOT>${markdownContent}</ROOT>`;
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');

        if (doc.querySelector('parsererror')) {
            console.error('XML Parsing Error. Check for unmatched custom tags.');
            return `<div class="dp-error-message">Error: Malformed Custom Tags. Check your XML tag balance.</div><p>${markdownContent.replace(/</g, '&lt;')}</p>`;
        }

        function buildHtml(xmlNode) {
            let html = '';

            if (xmlNode.tagName === 'DP-WRAPPER') {
                html += '<div class="dp-wrapper">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '<p>&nbsp;</p>\n</div>';
            }
            else if (xmlNode.tagName === 'CONTENT-BLOCK') {
                html += '<div class="dp-content-block">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            else if (xmlNode.tagName === 'ACCORDION') {
                html += '<div class="dp-accordion-group">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            else if (xmlNode.tagName === 'PANEL-GROUP') {
                html += '<div class="dp-panel-group">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            else if (xmlNode.tagName === 'PANEL-HEADING') {
                html += `<div class="dp-panel-heading"><p>${xmlNode.textContent.trim()}</p></div>\n`;
            }
            else if (xmlNode.tagName === 'PANEL-CONTENT') {
                html += '<div class="dp-panel-content">\n';
                Array.from(xmlNode.children).forEach(child => {
                    html += buildHtml(child);
                });
                html += '</div>\n';
            }
            else if (xmlNode.tagName === 'MODULE-PROGRESS-BAR') {
                 return '';
            }
            else if (xmlNode.nodeType === Node.TEXT_NODE) {
                const lines = xmlNode.textContent.split('\n');

                lines.forEach(line => {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) return;

                    const iconMatch = trimmedLine.match(ICON_HEADER_RE);
                    if (iconMatch) {
                        const iconClasses = iconMatch[1];
                        const headingContent = iconMatch[2].trim();
                        const hLevel = headingContent.match(/^(#+)\s*/);

                        if (hLevel) {
                            const level = hLevel[1].length;
                            const text = headingContent.substring(hLevel[0].length);
                            const iconHtml = `<span class="dps-icon ${iconClasses}" aria-hidden="true"></span>`;
                            html += `<h${level}>${iconHtml} ${text}</h${level}>\n`;
                        } else {
                            html += `<p><span class="dps-icon ${iconClasses}" aria-hidden="true"></span> ${headingContent}</p>\n`;
                        }
                    } 
                    else if (trimmedLine.startsWith('#')) {
                        const headingMatch = trimmedLine.match(/^(#+)\s*(.*)$/);
                        if (headingMatch) {
                            const level = headingMatch[1].length;
                            const text = headingMatch[2];
                            html += `<h${level}>${text}</h${level}>\n`;
                        }
                    }
                    else if (trimmedLine.startsWith('- ') || trimmedLine.match(/^\d+\.\s/)) {
                        const listItems = [];
                        let isOrdered = trimmedLine.match(/^\d+\.\s/);
                        let listTag = isOrdered ? 'ol' : 'ul';
                        
                        listItems.push(trimmedLine.substring(trimmedLine.indexOf(' ') + 1));
                        
                        html += `<${listTag}><li>${listItems.join('</li><li>')}</li></${listTag}>\n`;
                    }
                    else {
                        let formatted = trimmedLine
                            .replace(boldRe, '<strong>$1</strong>')
                            .replace(italicRe, '<em>$1</em>')
                            .replace(TAGS.USER_SHORT_NAME_TOKEN, '<span class="dp-personalized-token dp-user-short-name-placeholder">[Current User Short Name]</span>');

                        html += `<p>${formatted}</p>\n`;
                    }
                });
            }

            return html;
        }

        Array.from(doc.documentElement.children).forEach(node => {
            finalHtml += buildHtml(node);
        });

        return finalHtml;
    }

    // -------------------------------------------------------------------------
    // 5. VALIDATION (Simplified)
    // -------------------------------------------------------------------------

    function validateMDSyntax(markdownContent) {
        const doc = (new DOMParser()).parseFromString(`<ROOT>${markdownContent}</ROOT>`, 'text/xml');
        
        if (doc.querySelector('parsererror')) {
             // Replaced alert() with console.error as alerts block execution in many environments
             console.error("Validation Failed: Check your custom XML tag balance. (e.g., is every <CONTENT-BLOCK> closed with a </CONTENT-BLOCK>?)");
             return false;
        }
        return true;
    }


    // -------------------------------------------------------------------------
    // 6. UI AND EVENT HANDLERS (Using MutationObserver)
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
    
    // Core function to setup the menu and button once the editor is found
    function setupUI(editorToolbar) {
        console.log("DP Tools: Toolbar found. Setting up UI buttons.");
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
                
                const blob = new Blob([markdownContent], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'designplus_content.md';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Using console.log/custom message instead of alert
                console.log('Content extracted and download started. Markdown uses XML-style tags (<TAG>).');
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
                if (!validateMDSyntax(md)) return false; 
                
                const preHtml = parseDesignPlusMarkdownToHTML(md);
                const finalHtml = removeEmptyParagraphsWithNBSP(preHtml);

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
        trigger.onclick = (e) => { e.preventDefault(); menu.style.display = 'block'; };

        const toolbarGroup = editorToolbar.querySelector('.mce-container-body');
        if (toolbarGroup) {
            toolbarGroup.appendChild(trigger);
        } else {
            // Fallback: Append directly to the main toolbar element if the specific container isn't found
             editorToolbar.appendChild(trigger);
        }
    }
    
    /**
     * Uses a MutationObserver to wait for the TinyMCE editor toolbar to be added to the DOM.
     */
    function observeEditorLoad() {
        // Find the most stable parent container to observe changes in, typically document.body
        const targetNode = document.body;
        
        // Configuration for the observer: listen for child elements being added anywhere in the subtree
        const config = { childList: true, subtree: true };

        const callback = function(mutationsList, observer) {
            // Check for the editor toolbar element
            const editorToolbar = document.querySelector('.tox-editor-header');
            if (editorToolbar) {
                // Toolbar found: set up the UI and stop observing
                setupUI(editorToolbar);
                observer.disconnect();
                // console.log("DP Tools: MutationObserver disconnected. UI is live.");
            }
        };

        // Create an observer instance and attach the callback function
        const observer = new MutationObserver(callback);
        
        // Start observing the target node for configured mutations
        observer.observe(targetNode, config);
        // console.log("DP Tools: MutationObserver started, waiting for editor toolbar...");
    }

    // Fix: Wait for the 'load' event to ensure document.body is fully available before 
    // starting the MutationObserver, preventing the "parameter 1 is not of type 'Node'" error.
    window.addEventListener('load', observeEditorLoad);

})();
