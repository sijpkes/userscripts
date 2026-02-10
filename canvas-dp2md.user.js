(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // 1. CONSTANTS (XML-style Custom Tags)
    // -------------------------------------------------------------------------

    const TAGS = {
        DESIGN_WRAPPER_START: '<DP-WRAPPER>',
        DESIGN_WRAPPER_END: '</DP-WRAPPER>',
        HEADER_START: '<DP-HEADER>', // Updated to match previous logic
        HEADER_END: '</DP-HEADER>',
        HEADER_PRE_TAG: '<DP-HEADER-PRE>',
        HEADER_PRE_END_TAG: '</DP-HEADER-PRE>',
        HEADER_TITLE_TAG: '<DP-HEADER-TITLE>',
        HEADER_TITLE_END_TAG: '</DP-HEADER-TITLE>',
        HEADING_START: '<DP-HEADING>',
        HEADING_END: '</DP-HEADING>',
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
        DP_PROGRESS_BAR: '<DP-PROGRESS-BAR>',
        PLACEHOLDER: '<PLACEHOLDER>',
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

    function nodeClassListsContain(node, classNames) {
        if (!node.classList) return false;
        return classNames.some(cn => node.classList.contains(cn));
    }
    function convertToMarkdown(htmlElement) {
        let md = '';

        function processNode(node) {
            let nodeMd = '';

            // 1. WRAPPER: Handle underscore 'kl_wrapper' from (C)
            if (node.classList && (node.classList.contains('dp-wrapper') || node.classList.contains('kl_wrapper'))) {
                nodeMd += TAGS.DESIGN_WRAPPER_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.DESIGN_WRAPPER_END + '\n';
            }
            // 2. PROGRESS BAR: Must check before generic 'P' handler
            else if (node.classList && (node.classList.contains('kl_module_progress_completion') || node.classList.contains('dp-progress-placeholder'))) {
                nodeMd += TAGS.DP_PROGRESS_BAR + '\n';
            }
            // 3. BANNER/HEADER: Check before generic 'DIV' or 'P'
            else if (node.id === 'kl_banner' || (node.classList && node.classList.contains('dp-header'))) {
                nodeMd += TAGS.HEADER_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.HEADER_END + '\n';
            }
            // 4. BANNER LEFT (Prefix): Check before generic 'SPAN'
            else if (node.id === 'kl_banner_left' || (node.classList && node.classList.contains('dp-header-pre'))) {
                const text = node.textContent.trim();
                nodeMd += `${TAGS.HEADER_PRE_TAG}${text}${TAGS.HEADER_PRE_END_TAG}\n`;
            }
            // 5. BANNER RIGHT (Title): Check before generic 'SPAN'
            else if (node.id === 'kl_banner_right' || (node.classList && node.classList.contains('dp-header-title'))) {
                const text = node.textContent.trim();
                nodeMd += `${TAGS.HEADER_TITLE_TAG}${text}${TAGS.HEADER_TITLE_END_TAG}\n`;
            }
            // 6. SPECIFIC HEADING: Check for H2 inside banner specifically
            else if (node.tagName === 'H2' && (node.parentElement?.id === 'kl_banner' || (node.classList && node.classList.contains('dp-heading')))) {
                nodeMd += TAGS.HEADING_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.HEADING_END + '\n';
            }
            // 7. CONTENT BLOCKS - include legacy
            else if (node.classList && node.classList.contains('dp-content-block') ||
                (node.id && (
                    node.id.startsWith('kl_custom_block') ||
                    node.id.startsWith('kl_activities') ||
                    node.id.startsWith('kl_content_block')
                ))) {
                nodeMd += TAGS.BLOCK_START + '\n';
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
                nodeMd += TAGS.BLOCK_END + '\n';
            }
            // 8. LISTS
            else if (node.tagName === 'UL' || node.tagName === 'OL') {
                nodeMd += convertListToMarkdown(node) + '\n';
            }
            // 9. GENERIC HEADINGS: Only if specific DP-HEADING checks failed
            else if (node.tagName.match(/^H[1-6]$/)) {
                let text = node.textContent.trim();
                const hLevel = node.tagName.substring(1);
                const iconSpan = node.querySelector('.dps-icon');
                if (iconSpan) {
                    const iconClasses = Array.from(iconSpan.classList).filter(c => c !== 'dps-icon').join(' ');
                    nodeMd += `<ICON ${iconClasses}> ${'#'.repeat(hLevel)} ${text}\n`;
                } else {
                    nodeMd += `${'#'.repeat(hLevel)} ${text}\n`;
                }
            }
            // 10. GENERIC PARAGRAPHS
            else if (node.tagName === 'P') {
                // If the paragraph contains an iframe or wrapper, we must process children individually
                if (node.querySelector('iframe, .mce-object-iframe')) {
                    let pContent = '';
                    Array.from(node.childNodes).forEach(child => {
                        pContent += processNode(child);
                    });
                    nodeMd += pContent.trim() + '\n';
                } else {
                    // Standard text paragraph logic
                    let text = node.innerHTML.trim();
                    text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
                    text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
                    text = text.replace(/<span class="dp-personalized-token dp-user-short-name-placeholder">\[Current User Short Name\]<\/span>/g, TAGS.USER_SHORT_NAME_TOKEN);

                    if (text && text !== '&nbsp;' && text !== '<br>') {
                        nodeMd += text + '\n';
                    }
                }
            }
            else if (node.tagName === 'IFRAME' || (node.classList && node.classList.contains('mce-object-iframe'))) {
                // TinyMCE stores the real values in data-mce-p attributes on the span wrapper
                const src = node.getAttribute('data-mce-p-src') || node.getAttribute('src') || node.querySelector('iframe')?.getAttribute('src') || '';
                const title = node.getAttribute('data-mce-p-title') || node.getAttribute('title') || node.querySelector('iframe')?.getAttribute('title') || 'Untitled Resource';

                let type = 'lti';
                if (src.includes('youtube.com') || src.includes('youtu.be')) type = 'youtube';
                else if (src.includes('panopto.com')) type = 'panopto';
                else if (src.includes('vimeo.com')) type = 'vimeo';

                // We return the tag and STOP recursion here so the inner iframe isn't processed twice
                return `<${TAGS.PLACEHOLDER} type="${type}" source_url="${src}" title="${title}"></${TAGS.PLACEHOLDER}>\n`;
            }
            // 11. ELEMENT RECURSION: Catch-all for other containers
            else if (node.nodeType === Node.ELEMENT_NODE) {
                Array.from(node.children).forEach(child => {
                    nodeMd += processNode(child);
                });
            }

            return nodeMd;
        }

        const editorBody = htmlElement.contentDocument.body;
        const wrapper = editorBody.querySelector('.dp-wrapper, .kl_wrapper');

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
        // Ensure <br> is XML compliant and wrap in ROOT
        const sanitizedContent = markdownContent.replace(/<br>/g, '<br/>');
        const xmlString = `<ROOT>${sanitizedContent}</ROOT>`;

        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');

        if (doc.querySelector('parsererror')) {
            console.error('XML Parsing Error. Check for unmatched custom tags.');
            return `<div class="dp-error-message">Error: Malformed Custom Tags.</div><p>${markdownContent.replace(/</g, '&lt;')}</p>`;
        }

        function buildHtml(xmlNode) {
            let html = '';

            // --- HANDLE TEXT NODES ---
            if (xmlNode.nodeType === Node.TEXT_NODE) {
                const lines = xmlNode.textContent.split('\n');
                lines.forEach(line => {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) return;

                    // 1. Icon Header Match
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
                    // 2. Standard Markdown Heading
                    else if (trimmedLine.startsWith('#')) {
                        const headingMatch = trimmedLine.match(/^(#+)\s*(.*)$/);
                        if (headingMatch) {
                            const level = headingMatch[1].length;
                            const text = headingMatch[2];
                            html += `<h${level}>${text}</h${level}>\n`;
                        }
                    }
                    // 3. Lists
                    else if (trimmedLine.startsWith('- ') || trimmedLine.match(/^\d+\.\s/)) {
                        let isOrdered = trimmedLine.match(/^\d+\.\s/);
                        let listTag = isOrdered ? 'ol' : 'ul';
                        let content = trimmedLine.substring(trimmedLine.indexOf(' ') + 1);
                        html += `<${listTag}><li>${content}</li></${listTag}>\n`;
                    }

                    // 4. Regular Paragraphs / Formatting
                    else {
                        let formatted = trimmedLine
                            .replace(boldRe, '<strong>$1</strong>')
                            .replace(italicRe, '<em>$1</em>')
                            .replace(TAGS.USER_SHORT_NAME_TOKEN, '<span class="dp-personalized-token">[User]</span>');

                        html += `<p>${formatted}</p>\n`;
                    }
                });
                return html;
            }

            // --- HANDLE ELEMENT NODES ---
            if (xmlNode.nodeType === Node.ELEMENT_NODE) {
                const tagName = xmlNode.tagName.toUpperCase();

                switch (tagName) {
                    case 'DP-WRAPPER':
                        html += '<div class="dp-wrapper">\n';
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                        html += '<p>&nbsp;</p>\n</div>';
                        break;

                    case 'CONTENT-BLOCK':
                        html += '<div class="dp-content-block">\n';
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                        html += '</div>\n';
                        break;

                    case 'ACCORDION':
                    case 'PANEL-GROUP':
                        const className = tagName === 'ACCORDION' ? 'dp-accordion-group' : 'dp-panel-group';
                        html += `<div class="${className}">\n`;
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                        html += '</div>\n';
                        break;

                    case 'PANEL-HEADING':
                        html += `<div class="dp-panel-heading"><p>${xmlNode.textContent.trim()}</p></div>\n`;
                        break;

                    case 'PANEL-CONTENT':
                        html += '<div class="dp-panel-content">\n';
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                        html += '</div>\n';
                        break;

                    case 'BR':
                        html += '<br/>';
                        break;
                    case 'DP-PROGRESS-BAR':
                    case 'MODULE-PROGRESS-BAR':
                        html += '<div class="dp-progress-placeholder dp-module-progress-completion" style="display: none;">Module Item Completion (browser only)</div>\n';
                        break;

                    case 'DP-HEADER':
                        html += '<header class="dp-header">\n';
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                        html += '</header>\n';
                        break;

                    case 'DP-HEADING':
                        html += '<h2 class="dp-heading">';
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                        html += '</h2>\n';
                        break;

                    case 'DP-HEADER-PRE':
                        html += `<span class="dp-header-pre"><span class="dp-header-pre-1">${xmlNode.textContent.trim()}</span> </span>;`
                        break;

                    case 'DP-HEADER-TITLE':
                        html += `<span class="dp-header-title">${xmlNode.textContent.trim()}</span>`;
                        break;
                    case 'PLACEHOLDER':
                        const type = xmlNode.getAttribute('type');
                        const url = xmlNode.getAttribute('source_url');
                        const pTitle = xmlNode.getAttribute('title') || 'Untitled Resource';

                        html += `
    <div class="dp-placeholder" style="padding: 15px; border: 2px dashed #2b74bc; border-radius: 8px; margin: 15px 0; background: #f9f9f9; display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 24px;">📺</span>
        <div>
            <strong style="display: block; color: #2b74bc;">${pTitle}</strong>
            <span style="font-size: 0.85em; color: #666;">Type: ${type.toUpperCase()}</span><br>
            <a href="${url}" target="_blank" rel="noopener" style="color: #d93025; text-decoration: underline; font-weight: bold;">View or Embed Video Source</a>
        </div>
    </div>\n`;
                        break;
                    default:
                        // If it's an unknown tag, we still want to process its children
                        Array.from(xmlNode.childNodes).forEach(child => html += buildHtml(child));
                }
            }

            return html;
        }

        // Start traversal from ROOT childNodes
        Array.from(doc.documentElement.childNodes).forEach(node => {
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

        const callback = function (mutationsList, observer) {
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