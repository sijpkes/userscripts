// ==UserScript==
// @name         Canvas DesignPlus to Markdown
// @namespace    http://tampermonkey.net/
// @version      1.6 
// @description  Convert to or from DesignPLUS HTML in Canvas to or from Markdown with custom markers, handling mixed and nested content correctly.
// @author       Paul Sijpkes
// @match        https://*/courses/*/pages/*/edit
// @match        https://*/courses/*/discussion_topics/*/edit
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// @downloadURL  https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// ==/UserScript==


(function () {
    'use strict';

    // Markdown pseudo-tags for DesignPlus components
    const DESIGN_WRAPPER_START = '<<DESIGN PLUS WRAPPER START>>';
    const DESIGN_WRAPPER_END = '<<DESIGN PLUS WRAPPER END>>';
    const HEADER_START = '<<HEADER START>>';
    const HEADER_END = '<<HEADER END>>';
    const BLOCK_START = '<<CONTENT BLOCK START>>';
    const BLOCK_END = '<<CONTENT BLOCK END>>';
    const ACCORDION_START = '<<ACCORDIAN>>';
    const ACCORDION_END = '<</ACCORDIAN>>';
    const PANEL_GROUP_START = '<<PANEL-GROUP>>';
    const PANEL_GROUP_END = '<</PANEL-GROUP>>';
    const PANEL_HEADING_TAG = '<<PANEL-HEADING>>';
    const PANEL_HEADING_END_TAG = '<</PANEL-HEADING>>';
    const PANEL_CONTENT_START = '<<PANEL-CONTENT>>';
    const PANEL_CONTENT_END = '<</PANEL-CONTENT>>';
    const ICON_REGEX = /<<ICON\s+([^>]+)>>/;


    /**
     * Converts a markdown-like string with headings and bullet points into
     * a DesignPlus Accordion HTML structure. This function is specifically
     * designed to take the '#### heading' followed by lists format and
     * produce the full dp-panels-wrapper HTML.
     *
     * @param {string} markdownInput The input string containing markdown headings and lists.
     * @returns {string} The generated HTML for a DesignPlus Accordion.
     */
    function convertMarkdownToDesignPlusAccordion(markdownInput) {
        const panels = [];
        const blocks = markdownInput.split(/(?=\n#### )/g);

        function encodeHtmlEntities(str) {
            let encodedStr = str;
            encodedStr = encodedStr.replace(/&/g, '&amp;');
            encodedStr = encodedStr.replace(/</g, '&lt;');
            encodedStr = encodedStr.replace(/>/g, '&gt;');
            encodedStr = encodedStr.replace(/"/g, '&quot;');
            encodedStr = encodedStr.replace(/'/g, '&apos;');
            encodedStr = encodedStr.replace(/“/g, '&ldquo;');
            encodedStr = encodedStr.replace(/”/g, '&rdquo;');
            encodedStr = encodedStr.replace(/‘/g, '&lsquo;');
            encodedStr = encodedStr.replace(/’/g, '&rsquo;');
            encodedStr = encodedStr.replace(/…/g, '&hellip;');
            encodedStr = encodedStr.replace(/→/g, '&rarr;');
            return encodedStr;
        }

        function parseListToHtml(listMarkdownLines) {
            let html = '<ul>';
            const listItemRegex = /^(\s*)[*+-]\s*(.*)$/;
            const olListItemRegex = /^\d+\.\s*(.*)$/;

            for (const line of listMarkdownLines) {
                let content = '';
                const listItemMatch = line.match(listItemRegex);
                const olListItemMatch = line.match(olListItemRegex);

                if (listItemMatch) {
                    content = encodeHtmlEntities(listItemMatch[2].trim());
                    html += `\n                        <li>${content}</li>`;
                } else if (olListItemMatch) {
                    content = encodeHtmlEntities(olListItemMatch[1].trim());
                    html += `\n                        <li>${content}</li>`;
                }
            }
            html += '\n                    </ul>';
            return html;
        }

        for (let block of blocks) {
            if (block.startsWith('\n')) {
                block = block.substring(1);
            }

            const lines = block.split('\n');
            let heading = '';
            const listMarkdownLines = [];
            const headingRegex = /^####\s*(.*)$/;

            let headingFound = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const headingMatch = line.match(headingRegex);

                if (headingMatch && !headingFound) {
                    heading = encodeHtmlEntities(headingMatch[1].trim());
                    headingFound = true;
                } else if (headingFound && line.trim() !== '') {
                    listMarkdownLines.push(line);
                }
            }

            if (heading && listMarkdownLines.length > 0) {
                panels.push({
                    heading: heading,
                    listHtml: parseListToHtml(listMarkdownLines)
                });
            }
        }

        let fullHtml = `<div class="dp-panels-wrapper dp-accordion-default dp-panel-heading-text-start">`;
        for (const panel of panels) {
            fullHtml += `
            <div class="dp-panel-group">
                <h5 class="dp-panel-heading">${panel.heading}</h5>
                <div class="dp-panel-content">
                    ${panel.listHtml}
                </div>
            </div>`;
        }
        fullHtml += `\n        </div>`;

        return fullHtml;
    }


    function getIframeElement() {
        return document.getElementById('wiki_page_body_ifr') || document.getElementById("discussion-topic-message-body_ifr")
    }

    function waitForIframe(callback) {
        const interval = setInterval(() => {
            const iframe = getIframeElement();
            if (iframe?.contentDocument?.body) {
                clearInterval(interval);
                callback(iframe);
            }
        }, 500);
    }

    function getFileNameFromBreadcrumbs() {
        const crumbs = document.querySelectorAll('#breadcrumbs li');
        if (crumbs.length < 2) return 'canvas-page.md';
        const course = crumbs[1].textContent.trim().replace(/[()]/g, '').replace(/\s+/g, ' ');
        const page = crumbs[crumbs.length - 1].textContent.trim().replace(/[:]/g, '').replace(/\s+/g, ' ');
        return `${course} ${page}.md`;
    }

    /**
     * Converts a DesignPlus Accordion HTML structure into markdown pseudo tags.
     * @param {HTMLElement} accordionWrapper The .dp-panels-wrapper element.
     * @param {string} indent The indentation string (e.g., '  ' for outer, '    ' for inner).
     * @returns {string} Markdown string with accordion pseudo tags.
     */
    function convertAccordionToMarkdownPseudoTags(accordionWrapper, indent = '') {
        let md = `${indent}${ACCORDION_START}\n`;

        // Use :scope > to ensure only direct children .dp-panel-group are selected
        accordionWrapper.querySelectorAll(':scope > .dp-panel-group').forEach(panelGroup => {
            md += `${indent}  ${PANEL_GROUP_START}\n`;

            const headingElement = panelGroup.querySelector(':scope > .dp-panel-heading');
            if (headingElement) {
                md += `${indent}    ${PANEL_HEADING_TAG}${headingElement.textContent.trim()}${PANEL_HEADING_END_TAG}\n`;
            }

            const contentElement = panelGroup.querySelector(':scope > .dp-panel-content');
            if (contentElement) {
                md += `${indent}    ${PANEL_CONTENT_START}\n`;
                // Iterate through all list items within the content and convert to markdown list
                contentElement.querySelectorAll('li').forEach(li => {
                    md += `${indent}      * ${li.textContent.trim()}\n`;
                });
                md += `${indent}    ${PANEL_CONTENT_END}\n`;
            }
            md += `${indent}  ${PANEL_GROUP_END}\n`;
        });

        md += `${indent}${ACCORDION_END}\n`;
        return md;
    }

    /**
     * Converts a DesignPLUS HTML wrapper element into a markdown string,
     * handling various DesignPLUS components including nested accordions.
     *
     * @param {HTMLElement} dpRootElement The main DesignPLUS root element (#dp-wrapper) or similar top-level container.
     * @returns {string} The generated markdown string.
     */
    function convertToMarkdown(dpRootElement) {
        let md = '';

        // Add overall DESIGN_WRAPPER_START at the beginning of the output
        md += `${DESIGN_WRAPPER_START}\n\n`;

        // Iterate through all direct children of the dpRootElement to find DesignPlus components
        // This ensures correct order and captures all top-level DP elements.
        Array.from(dpRootElement.children).forEach(child => {
            if (child.classList.contains('dp-progress-completion')) {
                md += `<<MODULE PROGRESS BAR>>\n`;
            } else if (child.classList.contains('dp-header')) {
                const pre = child.querySelector('.dp-header-pre-1')?.textContent.trim() || '';
                const title = child.querySelector('.dp-header-title')?.textContent.trim() || '';
                md += `${HEADER_START}\n`;
                md += `## ${pre}: ${title}\n`;
                md += `${HEADER_END}\n\n`;
            } else if (child.classList.contains('dp-panels-wrapper') && child.classList.contains('dp-accordion-default')) {
                // Top-level accordion (not nested inside a content block)
                md += convertAccordionToMarkdownPseudoTags(child, ''); // No extra indent for top-level
            } else if (child.classList.contains('dp-content-block')) {
                // This is a standard content block, which can contain various HTML elements, including nested accordions
                const block = child;
                const blockId = block.getAttribute('data-id');
                if (blockId) md += `<!-- dp-id: ${blockId} -->\n`;
                md += `${BLOCK_START}\n\n`;

                // Iterate through children of the content block to maintain content order
                Array.from(block.children).forEach(blockChild => {
                    if (blockChild.matches('h1, h2, h3, h4, h5, h6')) {
                        const level = parseInt(blockChild.tagName.substring(1), 10);
                        const hashes = '#'.repeat(level);
                        const icon = blockChild.querySelector('i');
                        if (icon) {
                            const iconClass = [...icon.classList].filter(c => c.startsWith('fa')).join(' ');
                            md += `<<ICON ${iconClass}>> `;
                        }
                        md += `${hashes} ${blockChild.textContent.trim()}\n\n`;
                    } else if (blockChild.matches('p')) {
                        const text = blockChild.innerText.trim();
                        if (text) md += `${text}\n\n`;
                    } else if (blockChild.matches('ul, ol')) {
                        // Handle standard unordered/ordered lists within content blocks
                        const listTag = blockChild.tagName.toLowerCase();
                        Array.from(blockChild.children).forEach((li, i) => {
                            if (listTag === 'ol') {
                                md += `${i+1}. ${li.innerText.trim()}\n`;
                            } else {
                                md += `* ${li.innerText.trim()}\n`;
                            }
                        });
                        md += '\n'; // Add newline after each list
                    } else if (blockChild.matches('iframe')) {
                        const src = blockChild.getAttribute('src');
                        const title = blockChild.getAttribute('title');
                        if (title) md += `<!-- dp-iframe-title: ${title} -->\n`;
                        if (src) md += `[Embedded Content](${src})\n\n`;
                    } else if (blockChild.matches('a[href]')) { // Direct links inside block
                        const href = blockChild.href;
                        const text = blockChild.textContent.trim();
                        if (href && text) md += `[${text}](${href})\n\n`;
                    } else if (blockChild.classList.contains('dp-panels-wrapper') && blockChild.classList.contains('dp-accordion-default')) {
                        // Nested accordion inside a content block
                        // Pass an indent string to indicate nesting level in markdown.
                        md += convertAccordionToMarkdownPseudoTags(blockChild, '  ');
                    }
                    // TODO: Add handling for other HTML elements that might be direct children of dp-content-block
                });
                md += `${BLOCK_END}\n\n`;
            } else if (child.tagName === 'P' && child.textContent.trim() === '&nbsp;') {
                // Ignore the common <p>&nbsp;</p> at the very end of dp-wrapper
                // This is a heuristic, consider if other <p>&nbsp;</p> should be kept
                if (child === dpRootElement.lastElementChild) {
                    // Do nothing for the last element if it's just a spacer paragraph
                } else {
                    md += `\n`; // Convert to a blank line
                }
            }
            // TODO: Add conditions for any other top-level content structures if they exist,
            // beyond header/progress/content-block/accordion (e.g., custom HTML div wrappers)
        });

        // Add overall DESIGN_WRAPPER_END at the end
        md += `${DESIGN_WRAPPER_END}\n`;
        return md;
    }


    /**
     * Converts a markdown string (potentially with DesignPLUS pseudo-tags) into HTML.
     * This function handles mixed content, including nested accordions.
     *
     * @param {string} input The markdown string to convert.
     * @returns {string} The generated HTML string.
     */
    function parseDesignPlusMarkdownToHTML(input) {
        const lines = input.trim().split('\n');
        let html = '';

        // State variables for nested parsing
        let inWrapper = false;
        let inBlock = false;
        let inAccordion = false;
        let inPanelGroup = false;
        let inPanelContent = false;
        let inList = false; // For standard UL/OL outside accordion
        let inOList = false; // For standard OL outside accordion
        let titleAdded = false;

        let iconPlaceholders = [];
        let iconCounter = 0;
        const titleInput = document.getElementById("TextInput___0") || document.getElementById("wikipage-title-input");
        let overrideTitle = titleInput.value;
        const boldRe = /\*\*(.*?)\*\*/g;
        const italicRe = /\*(.*?)\*/g;
        const ICON_HEADER_RE = /^<<ICON\s+(.+?)>>\s*###\s*(.+)$/;

        // --- ACCORDION AUTOCONVERSION DETECTION LOGIC ---
        // This runs only if NO explicit accordion pseudo-tags (<<ACCORDIAN>>) are found in the input.
        // It allows markdown structured with '#### heading' + lengthy lists to be auto-converted.
        let isPseudoTagAccordionPresent = input.includes(ACCORDION_START);
        let runAutoAccordionConversion = false;

        if (!isPseudoTagAccordionPresent) {
            let totalEstimatedListLines = 0;
            let hasH4Headings = false;
            let hasAnyListItems = false;

            const CHARS_PER_LINE = 70;
            const LINE_HEIGHT_PX = 20;
            const VIEWPORT_HEIGHT_PX = 600;
            const MIN_EFFECTIVE_LINES_FOR_ACCORDION = Math.ceil(VIEWPORT_HEIGHT_PX / LINE_HEIGHT_PX);

            for (const line of lines) {
                if (line.startsWith('#### ')) {
                    hasH4Headings = true;
                } else if (line.match(/^(\s*)[*+-]\s*(.*)$/)) {
                    hasAnyListItems = true;
                    const listItemContent = line.match(/^(\s*)[*+-]\s*(.*)$/)[2];
                    totalEstimatedListLines += Math.max(1, Math.ceil(listItemContent.length / CHARS_PER_LINE));
                } else if (line.match(/^\d+\.\s*(.*)$/)) {
                    hasAnyListItems = true;
                    const listItemContent = line.match(/^\d+\.\s*(.*)$/)[1];
                    totalEstimatedListLines += Math.max(1, Math.ceil(listItemContent.length / CHARS_PER_LINE));
                }
            }

            if (hasAnyListItems && totalEstimatedListLines >= MIN_EFFECTIVE_LINES_FOR_ACCORDION && hasH4Headings) {
                runAutoAccordionConversion = true;
            }
        }
        // --- END ACCORDION AUTOCONVERSION DETECTION LOGIC ---


        // If auto-conversion is triggered AND no explicit pseudo-tags are present,
        // convert the entire original markdown input (assuming it's a pure accordion structure)
        // and return early. This handles cases like example (1) converting to example (2).
        if (runAutoAccordionConversion) {
            return convertMarkdownToDesignPlusAccordion(input);
        }


        // Main parsing loop for all other markdown, including explicit pseudo-tags and mixed content
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]; // Use original line including leading spaces for parsing context
            const trimmedLine = line.trim();

            // Handle overall DesignPlus Wrapper
            if (trimmedLine === DESIGN_WRAPPER_START) {
                html += `<div id="dp-wrapper" class="dp-wrapper kl_uon" data-img-url="https://designtools.ciditools.com/css/images/banner_desert_sky.png">\n`;
                inWrapper = true;
                continue;
            }
            if (trimmedLine === DESIGN_WRAPPER_END) {
                // Ensure all open blocks are closed before wrapper ends
                if (inPanelContent) { html += '                    </ul>\n                </div>\n'; inPanelContent = false; }
                if (inPanelGroup) { html += '            </div>\n'; inPanelGroup = false; }
                if (inAccordion) { html += '        </div>\n'; inAccordion = false; }
                if (inList) { html += '</ul>\n'; inList = false; }
                if (inOList) { html += '</ol>\n'; inOList = false; }
                if (inBlock) { html += '</div>\n'; inBlock = false; }

                html += '<p>&nbsp;</p>\n</div>'; // Closing wrapper and final paragraph
                inWrapper = false;
                continue;
            }

            // Handle CONTENT BLOCK START/END
            if (trimmedLine === BLOCK_START) {
                // Close any list before new block
                if (inList) { html += '</ul>\n'; inList = false; }
                if (inOList) { html += '</ol>\n'; inOList = false; }

                html += '<div class="dp-content-block">\n';
                inBlock = true;
                continue;
            }
            if (trimmedLine === BLOCK_END) {
                // Close any list or nested accordion before block ends
                if (inPanelContent) { html += '                    </ul>\n                </div>\n'; inPanelContent = false; }
                if (inPanelGroup) { html += '            </div>\n'; inPanelGroup = false; }
                if (inAccordion) { html += '        </div>\n'; inAccordion = false; } // Close nested accordion
                if (inList) { html += '</ul>\n'; inList = false; }
                if (inOList) { html += '</ol>\n'; inOList = false; }

                html += '</div>\n';
                inBlock = false;
                continue;
            }

            // Handle ACCORDION pseudo tags (can be top-level or nested within content blocks)
            if (trimmedLine === ACCORDION_START) {
                // Close any lists before starting accordion
                if (inList) { html += '</ul>\n'; inList = false; }
                if (inOList) { html += '</ol>\n'; inOList = false; }

                // Determine indentation for correct HTML nesting.
                // If we're inside a block, indent accordingly.
                const accordionIndent = inBlock ? '    ' : ''; // Adjust based on expected nesting depth
                html += `${accordionIndent}<div class="dp-panels-wrapper dp-accordion-default dp-panel-heading-text-start">\n`;
                inAccordion = true;
                continue;
            } else if (trimmedLine === ACCORDION_END) {
                if (inPanelContent) { html += '                    </ul>\n                </div>\n'; inPanelContent = false; }
                if (inPanelGroup) { html += '            </div>\n'; inPanelGroup = false; }
                const accordionIndent = inBlock ? '    ' : ''; // Match opening indent
                html += `${accordionIndent}</div>\n`;
                inAccordion = false;
                continue;
            } else if (inAccordion) { // Process panel-specific tags ONLY if currently within an accordion block
                if (trimmedLine === PANEL_GROUP_START) {
                    // Close previous panel group if open
                    if (inPanelGroup) {
                        if (inPanelContent) html += '                    </ul>\n                </div>\n';
                        html += '            </div>\n';
                    }
                    html += `            <div class="dp-panel-group">\n`;
                    inPanelGroup = true;
                    inPanelContent = false; // Reset content state for new panel
                    continue;
                } else if (trimmedLine.startsWith(PANEL_HEADING_TAG) && trimmedLine.endsWith(PANEL_HEADING_END_TAG)) {
                    const headingText = trimmedLine.substring(PANEL_HEADING_TAG.length, trimmedLine.length - PANEL_HEADING_END_TAG.length).trim();
                    html += `                <h5 class="dp-panel-heading">${headingText}</h5>\n`;
                    continue;
                } else if (trimmedLine === PANEL_CONTENT_START) {
                    html += `                <div class="dp-panel-content">\n                    <ul>\n`;
                    inPanelContent = true;
                    continue;
                } else if (trimmedLine.startsWith('* ') && inPanelContent) {
                    const listItemContent = trimmedLine.substring(2).trim();
                    html += `                        <li>${listItemContent}</li>\n`;
                    continue;
                } else if (trimmedLine === PANEL_CONTENT_END) {
                    html += `                    </ul>\n                </div>\n`;
                    inPanelContent = false;
                    continue;
                } else if (trimmedLine === PANEL_GROUP_END) {
                    html += `            </div>\n`;
                    inPanelGroup = false;
                    continue;
                }
            }


            // Handle other DesignPlus elements and general markdown
            // These are processed only if not currently inside an accordion pseudo-block
            if (!inAccordion) {
                if (trimmedLine === '<<MODULE PROGRESS BAR>>'){
                    html += `<div class="dp-progress-placeholder dp-module-progress-completion" style="display: none;">Module Item Completion (browser only)</div>`;
                    continue;
                }

                if (trimmedLine === HEADER_START) {
                    let title, pre1, pre2;
                    if (overrideTitle) {
                        overrideTitle = overrideTitle.trim();
                        const ovParts = overrideTitle.split(':');
                        pre1 = ovParts[0];
                        pre2 = '';
                        title = ovParts[1];
                    } else {
                        const headerText = lines[++i]?.trim() || '';
                        const [pre, ...titleParts] = headerText.split(':');
                        const [pre3, ...pre2Parts] = pre.trim().split(' ');
                        pre2 = pre2Parts.join(' ');
                        title = titleParts.join(':').trim();
                        pre1 = pre3;
                    }
                    html += `<header class="dp-header">\n<h2 class="dp-heading"><span class="dp-header-pre"> <span class="dp-header-pre-1">${pre1}</span> <span class="dp-header-pre-2">${pre2}</span> </span> <span class="dp-header-title">${title}</span></h2>\n</header>\n`;

                    // Skip everything until HEADER_END
                    while (i + 1 < lines.length && lines[i + 1].trim() !== HEADER_END) {
                        i++;
                    }
                    // Skip the HEADER_END itself
                    if (i + 1 < lines.length && lines[i + 1].trim() === HEADER_END) {
                        i++;
                    }
                    continue;
                }

                const iconHeaderMatch = trimmedLine.match(ICON_HEADER_RE);
                if (iconHeaderMatch) {
                    const icon = iconHeaderMatch[1].trim();
                    let heading = iconHeaderMatch[2].trim();

                    // Remove any accidental Markdown blockquote marker
                    if (heading.startsWith('>')) {
                        heading = heading.replace(/^>\s*/, '');
                    }

                    const placeholder = `<!-- ICON_PLACEHOLDER_${iconCounter} -->`;
                    html += `${placeholder}<h3>${heading}</h3>\n`;
                    iconPlaceholders.push({ placeholder, icon });
                    iconCounter++;
                    continue;
                }

                const headingMatch = trimmedLine.match(/^(#+)\s*(.*)$/);
                if (headingMatch) {
                    const level = headingMatch[1].length;
                    const headingText = headingMatch[2].trim();
                    html += `<h${level}>${headingText}</h${level}>\n`;
                    continue;
                }

                // Handle standard lists (outside accordion panels)
                if (trimmedLine.startsWith('1. ')) {
                    if (!inOList) { html += '<ol>\n'; inOList = true; }
                    let item = trimmedLine.substring(2).replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                    html += `<li>${item}</li>\n`;
                    continue;
                } else if (inOList && !trimmedLine.match(/^\d+\.\s/)) { // If previously in ordered list, but current line is not an item
                    html += '</ol>\n';
                    inOList = false;
                }

                if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ') || trimmedLine.startsWith('+ ')) {
                    if (!inList) { html += '<ul>\n'; inList = true; }
                    let item = trimmedLine.substring(2).replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                    html += `<li>${item}</li>\n`;
                    continue;
                } else if (inList && !trimmedLine.match(/^[*+-]\s/)) { // If previously in unordered list, but current line is not an item
                    html += '</ul>\n';
                    inList = false;
                }

                // Handle paragraphs
                let formatted = trimmedLine.replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                if (formatted) {
                    html += `<p>${formatted}</p>\n`;
                }
            }
        } // End of main parsing loop


        // Post-process icon placeholders
        iconPlaceholders.forEach(({ placeholder, icon }) => {
            html = html.replace(
                new RegExp(`${placeholder}<h3>(.*?)</h3>`),
                `<h3 class="dp-has-icon"><i class="${icon}"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>$1</h3>`
            );
        });

        return html;
    }

    function downloadMarkdown(filename, content) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function uploadMarkdownFile(callback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,text/markdown';
        input.addEventListener('change', e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = () => callback(reader.result);
            reader.readAsText(file);
        });
        input.click();
    }

    function addDropdownButton() {
        const iframe = getIframeElement();
        iframe.style.border = "4px solid #c9c";
        iframe.style.padding = "-4px";
        if (!iframe || document.getElementById('dp-md-dropdown')) return;

        const container = document.createElement('div');
        container.style.display = 'inline-block';
        container.style.position = 'relative';
        container.style.marginBottom = '10px';

        const dropdownBtn = document.createElement('button');
        dropdownBtn.textContent = 'Markdown Options ▾';
        dropdownBtn.className = 'btn btn-default';
        dropdownBtn.style.backgroundColor = '#ede';
        dropdownBtn.style.border = '1px solid #c9c'
        dropdownBtn.style.padding = '-4px'
        dropdownBtn.id = 'dp-md-dropdown';

        const menu = document.createElement('div');
        menu.style.position = 'absolute';
        menu.style.top = '100%';
        menu.style.left = '0';

        menu.style.border = '4px solid #c9c'
        menu.style.padding = '-4px'
        menu.style.zIndex = 9999;
        menu.style.display = 'none';
        menu.style.minWidth = '180px';

        const option1 = document.createElement('div');
        option1.textContent = '📥 Download Markdown';
        option1.style.padding = '8px';
        option1.style.cursor = 'pointer';
        option1.style.backgroundColor = '#ede';

        const option2 = document.createElement('div');
        option2.textContent = '📤 Upload Markdown';
        option2.style.padding = '8px';
        option2.style.cursor = 'pointer';
        option2.style.backgroundColor = '#ede';

        option1.onclick = () => {
            waitForIframe(iframe => {
                // IMPORTANT FIX: Target the actual #dp-wrapper, as it's the root for DP content.
                let dpRootElement = iframe.contentDocument.querySelector('#dp-wrapper');

                // Fallback: If #dp-wrapper is not found, it might be a simpler page where DP elements
                // are direct children of the body. In this case, use the body as the root.
                if (!dpRootElement) {
                    console.warn("DP Root #dp-wrapper not found, trying iframe body as root.");
                    dpRootElement = iframe.contentDocument.body;
                }

                if (!dpRootElement) {
                    alert('No DesignPLUS content found within #dp-wrapper or iframe body.');
                    return;
                }

                const md = convertToMarkdown(dpRootElement);
                const fileName = getFileNameFromBreadcrumbs();
                downloadMarkdown(fileName, md);
                menu.style.display = 'none';
            });
        };

        option2.onclick = () => {
            uploadMarkdownFile(md => {
                const html = parseDesignPlusMarkdownToHTML(md);
                waitForIframe(iframe => {
                    iframe.contentDocument.body.innerHTML = html;
                    menu.style.display = 'none';
                });
            });
        };

        dropdownBtn.onclick = () => {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        menu.appendChild(option1);
        menu.appendChild(option2);

        container.appendChild(dropdownBtn);
        container.appendChild(menu);

        document.getElementById('content-wrapper')?.insertBefore(container, document.getElementById('content-wrapper').firstChild);
    }

    window.addEventListener('load', () => {
        setTimeout(addDropdownButton, 1000);

    });
})();
