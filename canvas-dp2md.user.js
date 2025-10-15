// ==UserScript==
// @name         Canvas DesignPlus to Markdown
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Convert DesignPLUS HTML in Canvas to/from Markdown with custom markers, handling mixed and nested content.
// @author       Paul Sijpkes
// @match        https://*/courses/*/pages/*/edit
// @match        https://*/courses/*/discussion_topics/*/edit
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// @downloadURL  https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Constants ---
    const TAGS = {
        DESIGN_WRAPPER_START: '[DP WRAPPER]',
        DESIGN_WRAPPER_END: '[/DP WRAPPER]',
        HEADER_START: '[HEADER]',
        HEADER_END: '[/HEADER]',
        BLOCK_START: '[CONTENT BLOCK]',
        BLOCK_END: '[/CONTENT BLOCK]',
        ACCORDION_START: '[ACCORDION]',
        ACCORDION_END: '[/ACCORDION]',
        PANEL_GROUP_START: '[PANEL-GROUP]',
        PANEL_GROUP_END: '[/PANEL-GROUP]',
        PANEL_HEADING_TAG: '[PANEL-HEADING]',
        PANEL_HEADING_END_TAG: '[/PANEL-HEADING]',
        PANEL_CONTENT_START: '[PANEL-CONTENT]',
        PANEL_CONTENT_END: '[/PANEL-CONTENT]',
        ICON_REGEX: /\[ICON\s+([^>]+)\]/,
        MODULE_PROGRESS_BAR: '[MODULE PROGRESS BAR]'
    };

    const ICON_HEADER_RE = /^\[ICON\s+(.+?)\]\s*###\s*(.+)$/;
    const boldRe = /\*\*(.*?)\*\*/g, italicRe = /\*(.*?)\*/g;
    // --- Utility Functions ---
    function encodeHtmlEntities(str) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
            .replace(/“/g, '&ldquo;').replace(/”/g, '&rdquo;')
            .replace(/‘/g, '&lsquo;').replace(/’/g, '&rsquo;')
            .replace(/…/g, '&hellip;').replace(/→/g, '&rarr;');
    }

    function getIframeElement() {
        return document.getElementById('wiki_page_body_ifr') || document.getElementById("discussion-topic-message-body_ifr");
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

    // --- Markdown to Accordion HTML ---
    function convertMarkdownToDesignPlusAccordion(markdownInput) {
        const panels = [];
        const blocks = markdownInput.split(/(?=\n#### )/g);

        for (let block of blocks) {
            block = block.replace(/^\n/, '');
            const lines = block.split('\n');
            let heading = '';
            let contentLines = [];
            for (let line of lines) {
                const headingMatch = line.match(/^####\s*(.*)$/);
                if (headingMatch && !heading) {
                    heading = encodeHtmlEntities(headingMatch[1].trim());
                } else if (heading) {
                    if (line.trim()) contentLines.push(line);
                }
            }
            if (heading) {
                // Apply basic markdown for bold/italic within contentHtml for auto-accordion
                let contentHtml = contentLines.map(l => {
                    let formattedLine = encodeHtmlEntities(l.trim());
                    formattedLine = formattedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
                    return `<p>${formattedLine}</p>`;
                }).join('\n');
                panels.push({ heading, contentHtml });
            }
        }

        let fullHtml = `<div class="dp-panels-wrapper dp-accordion-default dp-panel-heading-text-start">`;
        for (const panel of panels) {
            fullHtml += `
            <div class="dp-panel-group">
                <h5 class="dp-panel-heading">${panel.heading}</h5>
                <div class="dp-panel-content">
                    ${panel.contentHtml}
                </div>
            </div>`;
        }
        fullHtml += `\n        </div>`;
        return fullHtml;
    }
    // --- Markdown Extraction ---
    function convertListToMarkdown(listElement, indent = '') {
        let md = '';
        const isOrdered = listElement.tagName.toLowerCase() === 'ol';
        Array.from(listElement.children).forEach((li, index) => {
            if (li.tagName.toLowerCase() !== 'li') return;
            const prefix = isOrdered ? `${index + 1}. ` : '* ';
            let lineText = '';
            for (const node of li.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) lineText += node.textContent.trim();
                else if (node.nodeType === Node.ELEMENT_NODE && !['ul', 'ol'].includes(node.tagName.toLowerCase())) lineText += node.textContent.trim();
            }
            md += `${indent}${prefix}${lineText}\n`;
            Array.from(li.children).forEach(child => {
                if (['ul', 'ol'].includes(child.tagName.toLowerCase())) {
                    md += convertListToMarkdown(child, indent + '    ');
                }
            });
        });
        return md;
    }

    function convertAccordionToMarkdownPseudoTags(accordionWrapper, indent = '') {
        let md = `${indent}${TAGS.ACCORDION_START}\n`;
        accordionWrapper.querySelectorAll(':scope > .dp-panel-group').forEach(panelGroup => {
            md += `${indent}  ${TAGS.PANEL_GROUP_START}\n`;
            const headingElement = panelGroup.querySelector(':scope > .dp-panel-heading');
            if (headingElement) md += `${indent}    ${TAGS.PANEL_HEADING_TAG}${headingElement.textContent.trim()}${TAGS.PANEL_HEADING_END_TAG}\n`;
            const contentElement = panelGroup.querySelector(':scope > .dp-panel-content');
            if (contentElement) {
                md += `${indent}    ${TAGS.PANEL_CONTENT_START}\n`;
                contentElement.querySelectorAll('li').forEach(li => {
                    md += `${indent}      * ${li.textContent.trim()}\n`;
                });
                md += `${indent}    ${TAGS.PANEL_CONTENT_END}\n`;
            }
            md += `${indent}  ${TAGS.PANEL_GROUP_END}\n`;
        });
        md += `${indent}${TAGS.ACCORDION_END}\n`;
        return md;
    }

    function convertToMarkdown(dpRootElement) {
        let md = `${TAGS.DESIGN_WRAPPER_START}\n\n`;
        Array.from(dpRootElement.children).forEach(child => {
            if (child.classList.contains('dp-progress-completion')) {
                md += `${TAGS.MODULE_PROGRESS_BAR}\n`;
            } else if (child.classList.contains('dp-header')) {
                const pre = child.querySelector('.dp-header-pre-1')?.textContent.trim() || '';
                const title = child.querySelector('.dp-header-title')?.textContent.trim() || '';
                md += `${TAGS.HEADER_START}\n## ${pre}: ${title}\n${TAGS.HEADER_END}\n\n`;
            } else if (child.classList.contains('dp-panels-wrapper') && child.classList.contains('dp-accordion-default')) {
                md += convertAccordionToMarkdownPseudoTags(child, '');
            } else if (child.classList.contains('dp-content-block')) {
                const blockId = child.getAttribute('data-id');
                if (blockId) md += `<!-- dp-id: ${blockId} -->\n`;
                md += `${TAGS.BLOCK_START}\n\n`;
                Array.from(child.children).forEach(blockChild => {
                    if (blockChild.matches('h1, h2, h3, h4, h5, h6')) {
                        const level = parseInt(blockChild.tagName.substring(1), 10);
                        const hashes = '#'.repeat(level);
                        const icon = blockChild.querySelector('i');
                        if (icon) {
                            const iconClass = [...icon.classList].filter(c => c.startsWith('fa')).join(' ');
                            md += `[ICON ${iconClass}] `;
                        }
                        md += `${hashes} ${blockChild.textContent.trim()}\n\n`;
                    } else if (blockChild.matches('p')) {
                        const text = blockChild.innerText.trim();
                        if (text) md += `${text}\n\n`;
                    } else if (blockChild.matches('ul, ol')) {
                        md += convertListToMarkdown(blockChild, '');
                        md += '\n';
                    } else if (blockChild.matches('iframe')) {
                        const src = blockChild.getAttribute('src');
                        const title = blockChild.getAttribute('title');
                        if (title) md += `<!-- dp-iframe-title: ${title} -->\n`;
                        if (src) md += `[Embedded Content](${src})\n\n`;
                    } else if (blockChild.matches('a[href]')) {
                        const href = blockChild.href;
                        const text = blockChild.textContent.trim();
                        if (href && text) md += `[${text}](${href})\n\n`;
                    } else if (blockChild.classList.contains('dp-panels-wrapper') && blockChild.classList.contains('dp-accordion-default')) {
                        md += convertAccordionToMarkdownPseudoTags(blockChild, '  ');
                    }
                });
                md += `${TAGS.BLOCK_END}\n\n`;
            } else if (child.tagName === 'P' && child.textContent.trim() === '&nbsp;') {
                if (child !== dpRootElement.lastElementChild) md += `\n`;
            }
        });
        md += `${TAGS.DESIGN_WRAPPER_END}\n`;
        return md;
    }

    // --- List Detection and Replacement ---
    function detectAndReplaceLists(documentContent) {
        const lines = documentContent.split('\n');
        const extractedListsData = [];
        const processedOutputLines = [];
        let currentListBlockItems = [], currentListBlockType = null, currentListBlockPlaceholder = null;
        let listCount = 0; // Generic counter for all lists

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const olMatch = line.match(/^(\s*)(\d+)\.\s*(.*)/);
            const ulMatch = line.match(/^(\s*)([*+-])\s*(.*)/);

            if (olMatch || ulMatch) {
                const itemType = olMatch ? 'OL' : 'UL';
                const isNewListBlock = currentListBlockType !== itemType || currentListBlockItems.length === 0;

                if (isNewListBlock) {
                    if (currentListBlockItems.length > 0) {
                        // Finalize the current list block
                        extractedListsData.push({
                            type: currentListBlockType,
                            rawLines: currentListBlockItems.slice(),
                            lineNumber: processedOutputLines.length // Store the line number
                        });
                        processedOutputLines.push(currentListBlockPlaceholder);
                    }

                    // Start a new list block
                    currentListBlockItems = [];
                    currentListBlockType = itemType;

                    // Increment the generic counter and generate the placeholder
                    listCount += 1;
                    currentListBlockPlaceholder = `__LIST_${listCount}__`;
                }

                currentListBlockItems.push(line);
            } else {
                if (currentListBlockItems.length > 0) {
                    // Finalize the current list block
                    extractedListsData.push({
                        type: currentListBlockType,
                        rawLines: currentListBlockItems.slice(),
                        lineNumber: processedOutputLines.length // Store the line number
                    });
                    processedOutputLines.push(currentListBlockPlaceholder);
                    currentListBlockItems = [];
                    currentListBlockType = null;
                    currentListBlockPlaceholder = null;
                }
                processedOutputLines.push(line);
            }
        }

        // Finalize any remaining list block
        if (currentListBlockItems.length > 0) {
            extractedListsData.push({
                type: currentListBlockType,
                rawLines: currentListBlockItems.slice(),
                lineNumber: processedOutputLines.length // Store the line number
            });
            processedOutputLines.push(currentListBlockPlaceholder);
        }

        return [processedOutputLines.join('\n'), extractedListsData];
    }

    // --- Nested List Parsing ---
    function parseNestedListLines(rawLines) {
        if (!rawLines) return [];
        const rootNodes = [];
        const stack = [];
        const boldRe = /\*\*(.*?)\*\*/g, italicRe = /\*(.*?)\*/g;
        for (const line of rawLines) {
            const olMatch = line.match(/^(\s*)(\d+)\.\s*(.*)/);
            const ulMatch = line.match(/^(\s*)([*+-])\s*(.*)/);
            if (olMatch || ulMatch) {
                const indent = olMatch ? olMatch[1].length : ulMatch[1].length;
                const markerType = olMatch ? 'ol' : 'ul';
                const content = (olMatch ? olMatch[3] : ulMatch[3]).replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>').trim();
                const newNode = { content, indent, markerType, children: [] };
                while (stack.length > 0 && indent <= stack[stack.length - 1].indent) stack.pop();
                if (stack.length === 0) rootNodes.push(newNode);
                else stack[stack.length - 1].node.children.push(newNode);
                stack.push({ node: newNode, indent, markerType });
            } else {
                const trimmedLine = line.trimStart();
                if (stack.length > 0) stack[stack.length - 1].node.content += (trimmedLine ? '\n' + trimmedLine : '\n');
            }
        }
        return rootNodes;
    }

    function renderNestedListHtml(nodes, listTag, indentStr = '') {
        if (!nodes.length) return '';
        let html = `${indentStr}<${listTag}>\n`;
        for (const node of nodes) {
            html += `${indentStr}    <li>${node.content}`;
            if (node.children.length > 0) {
                const childListTag = node.children[0].markerType;
                html += '\n' + renderNestedListHtml(node.children, childListTag, indentStr + '        ');
            }
            html += `</li>\n`;
        }
        html += `${indentStr}</${listTag}>`;
        return html;
    }

    function convertExtractedListsToHtml(extractedListsData) {
        return extractedListsData.map(listData => {
            const nestedNodes = parseNestedListLines(listData.rawLines);
            const listTag = listData.type === 'OL' ? 'ol' : 'ul'; // Decide list type based on `type`
            return renderNestedListHtml(nestedNodes, listTag, '');
        });
    }

    function insertHtmlListsIntoDocument(documentWithPlaceholders, htmlLists) {
        let finalDocument = documentWithPlaceholders;
        for (let i = 0; i < htmlLists.length; i++) {
            const placeholder = `__LIST_${i + 1}__`; // Generic placeholder
            if (finalDocument.includes(placeholder)) {
                finalDocument = finalDocument.replace(placeholder, htmlLists[i]);
            } else {
                console.error(`Placeholder ${placeholder} not found in the document.`);
            }
        }
        return finalDocument;
    }

    // --- Markdown to HTML ---
    function parseDesignPlusMarkdownToHTML(input) {
        const lines = input.trim().split('\n');
        let html = '', inWrapper = false, inBlock = false, inAccordion = false, inPanelGroup = false, inPanelContent = false;
        let inListInPanel = false; // NEW STATE VARIABLE to track <ul> presence within panel content
        let iconPlaceholders = [], iconCounter = 0;
        const titleInput = typeof document !== 'undefined' ? (document.getElementById("TextInput___0") || document.getElementById("wikipage-title-input")) : null;

        // Define regex for bold and italic markdown
        const boldRe = /\*\*(.*?)\*\*/g;
        const italicRe = /\*(.*?)\*/g;
        // Assuming ICON_HEADER_RE is defined elsewhere or not strictly needed for this problem
        const ICON_HEADER_RE = /[ICON\s+([^>]+)]\s*(.*)/;


        const isPseudoTagAccordionPresent = input.includes(TAGS.ACCORDION_START);
        let runAutoAccordionConversion = false;

        if (!isPseudoTagAccordionPresent) {
            let totalEstimatedListLines = 0, hasH4Headings = false, hasAnyListItems = false;
            const CHARS_PER_LINE = 70, LINE_HEIGHT_PX = 20, VIEWPORT_HEIGHT_PX = 600;
            const MIN_EFFECTIVE_LINES_FOR_ACCORDION = Math.ceil(VIEWPORT_HEIGHT_PX / LINE_HEIGHT_PX);
            for (const line of lines) {
                if (line.startsWith('#### ')) hasH4Headings = true;
                else if (line.match(/^(\s*)[*+-]\s*(.*)$/) || line.match(/^\d+\.\s*(.*)$/)) {
                    hasAnyListItems = true;
                    const listItemContent = line.replace(/^(\s*)[*+-]\s*|^\d+\.\s*/, '');
                    totalEstimatedListLines += Math.max(1, Math.ceil(listItemContent.length / CHARS_PER_LINE));
                }
            }
            if (hasAnyListItems && totalEstimatedListLines >= MIN_EFFECTIVE_LINES_FOR_ACCORDION && hasH4Headings) runAutoAccordionConversion = true;
        }
        if (runAutoAccordionConversion) return convertMarkdownToDesignPlusAccordion(input);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i], trimmedLine = line.trim();
            if (trimmedLine === TAGS.DESIGN_WRAPPER_START) {
                html += `<div id="dp-wrapper" class="dp-wrapper kl_uon" data-img-url="https://designtools.ciditools.com/css/images/banner_desert_sky.png">\n`;
                inWrapper = true; continue;
            }
            if (trimmedLine === TAGS.DESIGN_WRAPPER_END) {
                if (inPanelContent) {
                    if (inListInPanel) { html += '                    </ul>\n'; inListInPanel = false; }
                    html += '                </div>\n'; inPanelContent = false;
                }
                if (inPanelGroup) { html += '            </div>\n'; inPanelGroup = false; }
                if (inAccordion) { html += '        </div>\n'; inAccordion = false; }
                if (inBlock) { html += '</div>\n'; inBlock = false; }
                html += '<p>&nbsp;</p>\n</div>'; inWrapper = false; continue;
            }
            if (trimmedLine === TAGS.BLOCK_START) {
                html += '<div class="dp-content-block">\n'; inBlock = true; continue;
            }
            if (trimmedLine === TAGS.BLOCK_END) {
                if (inPanelContent) {
                    if (inListInPanel) { html += '                    </ul>\n'; inListInPanel = false; }
                    html += '                </div>\n'; inPanelContent = false;
                }
                if (inPanelGroup) { html += '            </div>\n'; inPanelGroup = false; }
                if (inAccordion) { html += '        </div>\n'; inAccordion = false; }
                html += '</div>\n'; inBlock = false; continue;
            }
            if (trimmedLine === TAGS.ACCORDION_START) {
                const accordionIndent = inBlock ? '    ' : '';
                html += `${accordionIndent}<div class="dp-panels-wrapper dp-accordion-default dp-panel-heading-text-start">\n`;
                inAccordion = true; continue;
            } else if (trimmedLine === TAGS.ACCORDION_END) {
                if (inPanelContent) {
                    if (inListInPanel) { html += '                    </ul>\n'; inListInPanel = false; }
                    html += '                </div>\n'; inPanelContent = false;
                }
                if (inPanelGroup) { html += '            </div>\n'; inPanelGroup = false; }
                const accordionIndent = inBlock ? '    ' : '';
                html += `${accordionIndent}</div>\n`; inAccordion = false; continue;
            } else if (inAccordion) {
                if (trimmedLine === TAGS.PANEL_GROUP_START) {
                    if (inPanelContent) {
                        if (inListInPanel) { html += '                    </ul>\n'; inListInPanel = false; }
                        html += '                </div>\n'; // Close dp-panel-content div
                        inPanelContent = false;
                    }
                    if (inPanelGroup) { html += '            </div>\n'; } // Close previous panel group
                    html += `            <div class="dp-panel-group">\n`;
                    inPanelGroup = true;
                    // Reset inPanelContent and inListInPanel for a new panel group
                    inPanelContent = false;
                    inListInPanel = false;
                    continue;
                } else if (trimmedLine.startsWith(TAGS.PANEL_HEADING_TAG) && trimmedLine.endsWith(TAGS.PANEL_HEADING_END_TAG)) {
                    const headingText = trimmedLine.substring(TAGS.PANEL_HEADING_TAG.length, trimmedLine.length - TAGS.PANEL_HEADING_END_TAG.length).trim();
                    html += `                <h5 class="dp-panel-heading">${headingText}</h5>\n`; continue;
                } else if (trimmedLine === TAGS.PANEL_CONTENT_START) {
                    html += `                <div class="dp-panel-content">\n`;
                    inPanelContent = true;
                    inListInPanel = false; // Reset list state for new panel content
                    continue;
                } else if (trimmedLine === TAGS.PANEL_CONTENT_END) {
                    if (inListInPanel) { html += '                    </ul>\n'; inListInPanel = false; } // Close <ul> if it was open
                    html += `                </div>\n`; // Close dp-panel-content div
                    inPanelContent = false; continue;
                } else if (trimmedLine === TAGS.PANEL_GROUP_END) {
                    if (inPanelContent) {
                        if (inListInPanel) { html += '                    </ul>\n'; inListInPanel = false; }
                        html += '                </div>\n'; inPanelContent = false;
                    }
                    html += `            </div>\n`; inPanelGroup = false; continue;
                }
                // Handle content WITHIN PANEL_CONTENT
                else if (inPanelContent) {
                    if (trimmedLine.startsWith('* ')) {
                        if (!inListInPanel) { // If not already in a list, open <ul>
                            html += `                    <ul>\n`;
                            inListInPanel = true;
                        }
                        const listItemContent = trimmedLine.substring(2).trim();
                        let formatted = listItemContent.replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                        html += `                        <li>${formatted}</li>\n`;
                    } else {
                        if (inListInPanel) { // If was in a list but current line is not a list item, close <ul>
                            html += `                    </ul>\n`;
                            inListInPanel = false;
                        }
                        // Handle general paragraph content
                        if (trimmedLine) { // Only add paragraph if line is not empty
                            let formatted = trimmedLine.replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                            html += `                    <p>${formatted}</p>\n`;
                        }
                    }
                    continue; // Consume the line
                }
            }
            if (!inAccordion) { // This block processes content outside of accordion tags
                if (trimmedLine === TAGS.MODULE_PROGRESS_BAR) {
                    html += `<div class="dp-progress-placeholder dp-module-progress-completion" style="display: none;">Module Item Completion (browser only)</div>`; continue;
                }
                if (trimmedLine === TAGS.HEADER_START) {
                    let title, pre1, pre2;

                    const headerText = lines[++i]?.trim() || '';
                    const [pre, ...titleParts] = headerText.split(':');
                    const preParts = pre.trim().split(' ');
                    pre1 = preParts[0] || '';
                    pre2 = preParts.slice(1).join(' ').trim();
                    title = titleParts.join(':').trim();

                    html += `<header class="dp-header">\n<h2 class="dp-heading"><span class="dp-header-pre"> <span class="dp-header-pre-1">${pre1}</span> <span class="dp-header-pre-2">${pre2}</span> </span> <span class="dp-header-title">${title}</span></h2>\n</header>\n`;
                    while (i + 1 < lines.length && lines[i + 1].trim() !== TAGS.HEADER_END) i++;
                    if (i + 1 < lines.length && lines[i + 1].trim() === TAGS.HEADER_END) i++;
                    continue;
                }
                const iconHeaderMatch = trimmedLine.match(ICON_HEADER_RE);
                if (iconHeaderMatch) {
                    const icon = iconHeaderMatch[1].trim();
                    let heading = iconHeaderMatch[2].trim();
                    if (heading.startsWith('>')) heading = heading.replace(/^>\s*/, '');
                    if (heading.startsWith('#')) heading = heading.replace(/^#+\s*/, '');
                    const placeholder = `<!-- ICON_PLACEHOLDER_${iconCounter} -->`;
                    html += `${placeholder}<h3>${heading}</h3>\n`;
                    iconPlaceholders.push({ placeholder, icon });
                    iconCounter++; continue;
                }
                const headingMatch = trimmedLine.match(/^(#+)\s*(.*)$/);
                if (headingMatch) {
                    const level = headingMatch[1].length;
                    const headingText = headingMatch[2].trim();
                    html += `<h${level}>${headingText}</h${level}>\n`; continue;
                }
                let formatted = trimmedLine.replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                if (formatted) html += `<p>${formatted}</p>\n`;
            }
        }
        iconPlaceholders.forEach(({ placeholder, icon }) => {
            html = html.replace(
                new RegExp(`${placeholder}<h3>(.*?)</h3>`),
                `<h3 class="dp-has-icon"><i class="${icon}"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>$1</h3>`
            );
        });
        return html;
    }

    // --- File Handling ---
    function downloadMarkdown(filename, content) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    function uploadMarkdownFile(callback) {
        const input = document.createElement('input');
        input.type = 'file';
        // Modified line: Add .txt and text/plain to the accept attribute
        input.accept = '.md,.txt,text/markdown,text/plain';
        input.addEventListener('change', e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = () => callback(reader.result);
            reader.readAsText(file);
        });
        input.click();
    }

    // --- Syntax Validation ---
    function validateMDSyntax(markdownContent) {
        const lines = markdownContent.split('\n');
        const validExactTags = new Set([
            TAGS.DESIGN_WRAPPER_START, TAGS.DESIGN_WRAPPER_END,
            TAGS.BLOCK_START, TAGS.BLOCK_END,
            TAGS.ACCORDION_START, TAGS.ACCORDION_END,
            TAGS.PANEL_GROUP_START, TAGS.PANEL_GROUP_END,
            TAGS.PANEL_CONTENT_START, TAGS.PANEL_CONTENT_END,
            TAGS.HEADER_START, TAGS.HEADER_END,
            TAGS.MODULE_PROGRESS_BAR
        ]);
        const ICON_HEADER_RE = /^[ICON\s+(.+?)]\s*###\s*(.+)$/;
        for (let i = 0; i < lines.length; i++) {
            const lineNumber = i + 1, line = lines[i], trimmedLine = line.trim();
            if (trimmedLine.includes('[') && trimmedLine.includes(']')) {
                if (validExactTags.has(trimmedLine)) continue;
                if (trimmedLine.startsWith(TAGS.PANEL_HEADING_TAG) && trimmedLine.endsWith(TAGS.PANEL_HEADING_END_TAG) && trimmedLine.length > TAGS.PANEL_HEADING_TAG.length + TAGS.PANEL_HEADING_END_TAG.length) continue;
                if (ICON_HEADER_RE.test(trimmedLine)) continue;
                alert(`Malformed DesignPlus tag found:\n"${line}"\nLine number: ${lineNumber}\nPlease correct the tag syntax.`);
                return false;
            }
        }
        return true;
    }

    /**
 * Efficiently removes all "<p>&nbsp;</p>" tags from a given HTML string.
 *
 * @param {string} htmlString The input HTML string.
 * @returns {string} The HTML string with all "<p>&nbsp;</p>" tags removed.
 */
    function removeEmptyParagraphsWithNBSP(htmlString) {
        // Use a regular expression with the 'g' flag for global replacement.
        // The '\s*' matches any whitespace character (space, tab, new line, etc.)
        // zero or more times, making it robust against minor variations in whitespace.
        // The 'i' flag (case-insensitive) is added for robustness, although 'p' tag is usually lowercase.
        return htmlString.replace(
            /<p[^>]*>(?:\s|&nbsp;|\u00A0|&#160;|&#xA0;)*<\/p>/gi,
            ''
        );
    }

    // --- UI ---
    function addDropdownButton() {
        const iframe = getIframeElement();
        if (!iframe || document.getElementById('dp-md-dropdown')) return;
        iframe.style.border = "4px solid #c9c";
        const container = document.createElement('div');
        container.style.display = 'inline-block';
        container.style.position = 'relative';
        container.style.marginBottom = '10px';

        const dropdownBtn = document.createElement('button');
        dropdownBtn.textContent = 'Markdown Options ▾';
        dropdownBtn.className = 'btn btn-default';
        dropdownBtn.style.backgroundColor = '#ede';
        dropdownBtn.style.border = '1px solid #c9c';
        dropdownBtn.id = 'dp-md-dropdown';

        const menu = document.createElement('div');
        menu.style.position = 'absolute';
        menu.style.top = '100%';
        menu.style.left = '0';
        menu.style.border = '4px solid #c9c';
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
                let dpRootElement = iframe.contentDocument.querySelector('#dp-wrapper') || iframe.contentDocument.body;
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
                if (!validateMDSyntax(md)) return false;
                const [mdWithPlaceholders, extractedListsData] = detectAndReplaceLists(md);
                console.log('Placeholders:', extractedListsData.map((data, index) => `__${data.type}_${index + 1}__`));

                const htmlWithPlaceholders = parseDesignPlusMarkdownToHTML(mdWithPlaceholders);

                console.log('Document with placeholders:', htmlWithPlaceholders);
                const htmlLists = convertExtractedListsToHtml(extractedListsData);
                const preHtml = insertHtmlListsIntoDocument(htmlWithPlaceholders, htmlLists, extractedListsData);
                const finalHtml = removeEmptyParagraphsWithNBSP(preHtml)
                waitForIframe(iframe => {
                    iframe.contentDocument.body.innerHTML = finalHtml;
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
