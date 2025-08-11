// ==UserScript==
// @name         Canvas DesignPlus to Markdown
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Convert to or from DesignPLUS HTML in Canvas to or from Markdown with custom markers
// @author       Paul Sijpkes
// @match        https://*/courses/*/pages/*/edit
// @match        https://*/courses/*/discussion_topics/*/edit
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// @downloadURL  https://raw.githubusercontent.com/sijpkes/userscripts/main/canvas-dp2md.user.js
// ==/UserScript==


(function () {
    'use strict';

    const DESIGN_WRAPPER_START = '<<DESIGN PLUS WRAPPER START>>';
    const DESIGN_WRAPPER_END = '<<DESIGN PLUS WRAPPER END>>';
    const HEADER_START = '<<HEADER START>>';
    const HEADER_END = '<<HEADER END>>';
    const BLOCK_START = '<<CONTENT BLOCK START>>';
    const BLOCK_END = '<<CONTENT BLOCK END>>';
    const ICON_REGEX = /<<ICON\s+([^>]+)>>/;

    /**
     * Converts a markdown-like string with headings and bullet points into
     * a DesignPlus Accordion HTML structure.
     *
     * This function is designed to take the entire markdown input (like example 1)
     * and produce the full accordion HTML output (like example 2).
     *
     * @param {string} markdownInput The input string containing markdown headings and lists.
     * @returns {string} The generated HTML for a DesignPlus Accordion.
     */
    function convertMarkdownToDesignPlusAccordion(markdownInput) {
        const panels = [];

        // Split the markdown input into blocks based on '#### ' followed by a newline.
        // The positive lookahead (?=\n#### ) ensures the delimiter itself (#### ) is preserved
        // at the beginning of each new block, making it easier to extract headings.
        const blocks = markdownInput.split(/(?=\n#### )/g);

        // Helper function to encode HTML entities for safe display in HTML.
        function encodeHtmlEntities(str) {
            let encodedStr = str;
            // Basic HTML entities (must be first for '&')
            encodedStr = encodedStr.replace(/&/g, '&amp;');
            encodedStr = encodedStr.replace(/</g, '&lt;');
            encodedStr = encodedStr.replace(/>/g, '&gt;');
            encodedStr = encodedStr.replace(/"/g, '&quot;'); // Standard straight double quotes
            encodedStr = encodedStr.replace(/'/g, '&apos;'); // Standard straight single quotes

            // Specific Unicode characters to HTML entities as seen in the example output (2)
            encodedStr = encodedStr.replace(/“/g, '&ldquo;'); // Left double quotation mark
            encodedStr = encodedStr.replace(/”/g, '&rdquo;'); // Right double quotation mark
            encodedStr = encodedStr.replace(/‘/g, '&lsquo;'); // Left single quotation mark
            encodedStr = encodedStr.replace(/’/g, '&rsquo;'); // Right single quotation mark
            encodedStr = encodedStr.replace(/…/g, '&hellip;'); // Horizontal ellipsis
            encodedStr = encodedStr.replace(/→/g, '&rarr;');   // Rightwards arrow

            return encodedStr;
        }

        // Helper function to parse list markdown lines into a flat <ul> HTML structure.
        function parseListToHtml(listMarkdownLines) {
            let html = '<ul>';
            // Regex to match a list item, capturing any leading whitespace and the content.
            const listItemRegex = /^(\s*)[*+-]\s*(.*)$/; // Handles *, -, + for bullet points
            const olListItemRegex = /^\d+\.\s*(.*)$/; // Handles 1., 2. for ordered lists

            for (const line of listMarkdownLines) {
                let content = '';
                const listItemMatch = line.match(listItemRegex);
                const olListItemMatch = line.match(olListItemRegex);

                if (listItemMatch) {
                    content = encodeHtmlEntities(listItemMatch[2].trim());
                    html += `\n                        <li>${content}</li>`;
                } else if (olListItemMatch) {
                    content = encodeHtmlEntities(olListItemMatch[1].trim());
                    // Since the target output (2) shows all lists as <ul> regardless of input numbering,
                    // we'll stick to <ul> here as per the example.
                    html += `\n                        <li>${content}</li>`;
                }
                // Non-list lines (e.g., empty lines between list items) are ignored as per example output.
            }
            html += '\n                    </ul>';
            return html;
        }

        // Process each block to extract heading and list content
        for (let block of blocks) {
            // Remove leading newline character that might be present from the split for subsequent blocks.
            if (block.startsWith('\n')) {
                block = block.substring(1);
            }

            const lines = block.split('\n');
            let heading = '';
            const listMarkdownLines = [];
            const headingRegex = /^####\s*(.*)$/; // Regex to find the heading line

            let headingFound = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const headingMatch = line.match(headingRegex);

                if (headingMatch && !headingFound) {
                    // If a heading is found and it's the first one in this block, extract it.
                    heading = encodeHtmlEntities(headingMatch[1].trim());
                    headingFound = true;
                } else if (headingFound && line.trim() !== '') {
                    // After the heading, all non-empty lines are considered potential list items.
                    listMarkdownLines.push(line);
                }
            }

            // If both a heading and list items are found, create a new panel.
            // The example output (2) shows that even lists with fewer than 3 items or short content
            // are converted if they follow a '####' heading.
            if (heading && listMarkdownLines.length > 0) {
                panels.push({
                    heading: heading,
                    listHtml: parseListToHtml(listMarkdownLines)
                });
            }
        }

        // Assemble the final HTML string for the entire accordion structure.
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
        fullHtml += `\n        </div>`; // Match closing tag indentation from example

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
     * @returns {string} Markdown string with accordion pseudo tags.
     */
    function convertAccordionToMarkdownPseudoTags(accordionWrapper) {
        let md = `<<ACCORDIAN>>\n`;

        accordionWrapper.querySelectorAll('.dp-panel-group').forEach(panelGroup => {
            md += `  <<PANEL-GROUP>>\n`;

            const headingElement = panelGroup.querySelector('.dp-panel-heading');
            if (headingElement) {
                md += `    <<PANEL-HEADING>>${headingElement.textContent.trim()}<</PANEL-HEADING>>\n`;
            }

            const contentElement = panelGroup.querySelector('.dp-panel-content');
            if (contentElement) {
                md += `    <<PANEL-CONTENT>>\n`;
                // Iterate through all list items within the content and convert to markdown list
                contentElement.querySelectorAll('li').forEach(li => {
                    md += `      * ${li.textContent.trim()}\n`;
                });
                md += `    <</PANEL-CONTENT>>\n`;
            }
            md += `  <</PANEL-GROUP>>\n`;
        });

        md += `<</ACCORDIAN>>\n`;
        return md;
    }

    function convertToMarkdown(wrapper) {
        let md = `${DESIGN_WRAPPER_START}\n\n`;

        // Check if the wrapper is a DesignPlus Accordion and handle it specifically
        const accordionWrapper = wrapper.querySelector('.dp-panels-wrapper.dp-accordion-default');
        if (accordionWrapper) {
            // If it's an accordion, use the dedicated function and return its markdown.
            // This assumes an accordion is the primary content, not mixed with other blocks.
            return `${DESIGN_WRAPPER_START}\n\n${convertAccordionToMarkdownPseudoTags(accordionWrapper)}${DESIGN_WRAPPER_END}\n`;
        }

        const progress = wrapper.querySelector('.dp-progress-completion');
        if (progress) {
            md += `<<MODULE PROGRESS BAR>>\n`;
        }

        const header = wrapper.querySelector('.dp-header');
        if (header) {
            const pre = header.querySelector('.dp-header-pre-1')?.textContent.trim() || '';
            const title = header.querySelector('.dp-header-title')?.textContent.trim() || '';
            md += `${HEADER_START}\n`;
            md += `## ${pre}: ${title}\n`;
            md += `${HEADER_END}\n\n`;
        }

        // Existing logic for non-accordion DesignPLUS content
        wrapper.querySelectorAll('.dp-content-block').forEach(block => {
            const blockId = block.getAttribute('data-id');
            if (blockId) md += `<!-- dp-id: ${blockId} -->\n`;
            md += `${BLOCK_START}\n\n`;

            const heading = block.querySelector('h1, h2, h3, h4, h5, h6');
            if (heading) {
                const level = parseInt(heading.tagName.substring(1), 10); // e.g., "H3" → 3
                const hashes = '#'.repeat(level); // Generate correct number of hashes
                const icon = heading.querySelector('i');

                if (icon) {
                    const iconClass = [...icon.classList]
                        .filter(c => c.startsWith('fa'))
                        .join(' ');
                    md += `<<ICON ${iconClass}>> `;
                }

                md += `${hashes} ${heading.textContent.trim()}\n\n`;
            }

            block.querySelectorAll('p').forEach(p => {
                const text = p.innerText.trim();
                if (text) md += `${text}\n\n`;
            });

            block.querySelectorAll('ul').forEach(ul => {
                ul.querySelectorAll('li').forEach(li => {
                    md += `* ${li.innerText.trim()}\n`;
                });
                md += '\n';
            });

            block.querySelectorAll('ol').forEach(ol => {
                ol.querySelectorAll('li').forEach((li, i) => {
                    md += `${i+1}. ${li.innerText.trim()}\n`;
                });
                md += '\n';
            });

            block.querySelectorAll('iframe').forEach(iframe => {
                const src = iframe.getAttribute('src');
                const title = iframe.getAttribute('title');
                if (title) md += `<!-- dp-iframe-title: ${title} -->\n`;
                if (src) md += `[Embedded Content](${src})\n\n`;
            });

            block.querySelectorAll('a').forEach(a => {
                const href = a.href;
                const text = a.textContent.trim();
                if (href && text) md += `[${text}](${href})\n\n`;
            });

            md += `${BLOCK_END}\n\n`;
        });

        md += `${DESIGN_WRAPPER_END}\n`;
        return md;
    }

    function parseDesignPlusMarkdownToHTML(input) {
        const lines = input.trim().split('\n');

        // --- ACCORDION DETECTION LOGIC BASED ON LIST LENGTH ---
        let totalEstimatedListLines = 0;
        let hasH4Headings = false;
        let hasAnyListItems = false;

        // Heuristic for "page height" based on 12pt font.
        // A common readability standard is 45-75 characters per line. Let's use 70 for calculation.
        const CHARS_PER_LINE = 70;
        // A typical line height for 12pt text is around 20px.
        const LINE_HEIGHT_PX = 20;
        // A rough estimate for user visible content height, e.g., 600px for a standard viewport.
        const VIEWPORT_HEIGHT_PX = 600;
        // Calculate the minimum number of effective lines needed to exceed estimated page height.
        const MIN_EFFECTIVE_LINES_FOR_ACCORDION = Math.ceil(VIEWPORT_HEIGHT_PX / LINE_HEIGHT_PX); // Approx 30 lines for 600px viewport

        // Check for <<ACCORDIAN>> pseudo tag as the primary indicator for parsing accordion HTML
        if (input.includes('<<ACCORDIAN>>')) {
             // If the pseudo tag is present, parse it back to the DesignPlus accordion HTML
            let html = `<div class="dp-panels-wrapper dp-accordion-default dp-panel-heading-text-start">\n`;
            let inPanelGroup = false;
            let inPanelContent = false;
            let currentHeading = '';

            for (const line of lines) {
                const trimmedLine = line.trim();

                if (trimmedLine === '<<PANEL-GROUP>>') {
                    if (inPanelGroup) { // Close previous panel group if open
                        if (inPanelContent) html += '                    </ul>\n                </div>\n';
                        html += '            </div>\n';
                    }
                    html += `            <div class="dp-panel-group">\n`;
                    inPanelGroup = true;
                    inPanelContent = false;
                    currentHeading = '';
                } else if (trimmedLine.startsWith('<<PANEL-HEADING>>') && trimmedLine.endsWith('<</PANEL-HEADING>>')) {
                    currentHeading = trimmedLine.substring('<<PANEL-HEADING>>'.length, trimmedLine.length - '<</PANEL-HEADING>>'.length).trim();
                    html += `                <h5 class="dp-panel-heading">${currentHeading}</h5>\n`;
                } else if (trimmedLine === '<<PANEL-CONTENT>>') {
                    html += `                <div class="dp-panel-content">\n                    <ul>\n`;
                    inPanelContent = true;
                } else if (trimmedLine.startsWith('* ') && inPanelContent) {
                    const listItemContent = trimmedLine.substring(2).trim();
                    html += `                        <li>${listItemContent}</li>\n`;
                } else if (trimmedLine === '<</PANEL-CONTENT>>') {
                    html += `                    </ul>\n                </div>\n`;
                    inPanelContent = false;
                } else if (trimmedLine === '<</PANEL-GROUP>>') {
                    html += `            </div>\n`;
                    inPanelGroup = false;
                } else if (trimmedLine === '<</ACCORDIAN>>') {
                    // Final close, if any group was left open (shouldn't be if tags are balanced)
                    if (inPanelGroup) {
                         if (inPanelContent) html += '                    </ul>\n                </div>\n';
                         html += '            </div>\n';
                    }
                    html += `        </div>`; // Match closing tag indentation from example
                    return html;
                }
            }
            return html; // Should ideally be returned after <</ACCORDIAN>>
        }


        // If not a pseudo-tag accordion, proceed with original detection logic
        for (const line of lines) {
            if (line.startsWith('#### ')) {
                hasH4Headings = true;
            } else if (line.match(/^(\s*)[*+-]\s*(.*)$/)) { // Bullet list item (covers nested due to simple line match)
                hasAnyListItems = true;
                const listItemContent = line.match(/^(\s*)[*+-]\s*(.*)$/)[2];
                // Estimate lines for this item, ensuring it counts as at least 1 line.
                totalEstimatedListLines += Math.max(1, Math.ceil(listItemContent.length / CHARS_PER_LINE));
            } else if (line.match(/^\d+\.\s*(.*)$/)) { // Ordered list item
                hasAnyListItems = true;
                const listItemContent = line.match(/^\d+\.\s*(.*)$/)[1];
                // Estimate lines for this item, ensuring it counts as at least 1 line.
                totalEstimatedListLines += Math.max(1, Math.ceil(listItemContent.length / CHARS_PER_LINE));
            }
        }

        // Condition for conversion to accordion HTML:
        // 1. There are actual list items present.
        // 2. The total estimated content lines from ALL list items collectively exceed the "page height" threshold.
        // 3. Critically, H4 headings are present in the markdown input, as they are essential for the
        //    DesignPlus Accordion structure (dp-panel-heading) as shown in the example output (2).
        //    Without them, the accordion panels cannot be properly titled.
        if (hasAnyListItems && totalEstimatedListLines >= MIN_EFFECTIVE_LINES_FOR_ACCORDION && hasH4Headings) {
            // If the criteria are met, delegate the entire conversion to the dedicated accordion function.
            // This function expects the markdown to be structured with #### headings.
            return convertMarkdownToDesignPlusAccordion(input);
        }
        // --- END ACCORDION DETECTION LOGIC ---


        // Existing line-by-line parsing logic for other markdown formats if no accordion is detected
        let html = '';
        let inWrapper = false;
        let inBlock = false;
        let inList = false;
        let inOList = false;
        let iconPlaceholders = [];
        let iconCounter = 0;
        const titleInput = document.getElementById("TextInput___0") || document.getElementById("wikipage-title-input");

        let overrideTitle = titleInput.value
        const boldRe = /\*\*(.*?)\*\*/g;
        const italicRe = /\*(.*?)\*/g;
        const ICON_HEADER_RE = /^<<ICON\s+(.+?)>>\s*###\s*(.+)$/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line === '<<DESIGN PLUS WRAPPER START>>') {
                html += `<div id="dp-wrapper" class="dp-wrapper kl_uon" data-img-url="https://designtools.ciditools.com/css/images/banner_desert_sky.png">\n`;
                inWrapper = true;
                continue;
            }

            if (line === '<<MODULE PROGRESS BAR>>'){
                if(inWrapper) {
                    html += `<div class="dp-progress-placeholder dp-module-progress-completion" style="display: none;">Module Item Completion (browser only)</div>`;
                    continue;
                }
            }

            if (line === '<<DESIGN PLUS WRAPPER END>>') {
                if (inList) html += '</ul>\n';
                if (inBlock) html += '</div>\n';
                html += '<p>&nbsp;</p>\n</div>';
                inWrapper = false;
                inBlock = false;
                inList = false;
                continue;
            }

            if (line === '<<CONTENT BLOCK START>>') {
                if (inBlock) {
                    if (inList) html += '</ul>\n';
                    html += '</div>\n';
                    inList = false;
                }
                html += '<div class="dp-content-block">\n';
                inBlock = true;
                continue;
            }

            if (line === '<<CONTENT BLOCK END>>') {
                if (inList) html += '</ul>\n';
                html += '</div>\n';
                inBlock = false;
                inList = false;
                continue;
            }

            if (line === '<<HEADER START>>') {
                let title, pre1, pre2
                if(overrideTitle) {
                    overrideTitle = overrideTitle.trim()
                    const ovParts = overrideTitle.split(':')
                    pre1 = ovParts[0]
                    pre2 = ''
                    title = ovParts[1]
                }


                const headerText = lines[++i]?.trim() || '';
                const [pre, ...titleParts] = headerText.split(':');
                const [pre3, ...pre2Parts] = pre.trim().split(' ');
                pre2 = pre2Parts.join(' ');

                title = titleParts.join(':').trim();
                pre1 = pre3

                html += `<header class="dp-header">\n<h2 class="dp-heading"><span class="dp-header-pre"> <span class="dp-header-pre-1">${pre1}</span> <span class="dp-header-pre-2">${pre2}</span> </span> <span class="dp-header-title">${title}</span></h2>\n</header>\n`;

                // Skip <<HEADER END>> if it's there
                if (lines[i + 1]?.trim() === '<<HEADER END>>') i++;

                continue;
            }

            const iconHeaderMatch = line.match(ICON_HEADER_RE);
            if (iconHeaderMatch) {
                const icon = iconHeaderMatch[1];
                const heading = iconHeaderMatch[2];
                const placeholder = `<!-- ICON_PLACEHOLDER_${iconCounter} -->`;
                html += `${placeholder}<h3>${heading}</h3>\n`;
                iconPlaceholders.push({ placeholder, icon });
                iconCounter++;
                continue;
            }

            // Handles general headings not necessarily within DesignPlus content blocks
            const headingMatch = line.match(/^(#+)\s*(.*)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const headingText = headingMatch[2].trim();
                html += `<h${level}>${headingText}</h${level}>\n`;
                continue;
            }


            if (line.startsWith('1. ')) {
                if (!inOList) {
                    html += '<ol>\n';
                    inOList = true;
                }
                let item = line.slice(2).replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                html += `<li>${item}</li>\n`;
                continue;
            } else if (inOList) {
                html += '</ol>\n';
                inOList = false;
            }

            if (line.startsWith('* ') || line.startsWith('- ') || line.startsWith('+ ')) {
                if (!inList) {
                    html += '<ul>\n';
                    inList = true;
                }
                let item = line.slice(2).replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
                html += `<li>${item}</li>\n`;
                continue;
            } else if (inList) {
                html += '</ul>\n';
                inList = false;
            }

            let formatted = line.replace(boldRe, '<strong>$1</strong>').replace(italicRe, '<em>$1</em>');
            // Ensure paragraphs are created only for actual text, not just empty lines that become '&nbsp;'
            if (formatted) {
                html += `<p>${formatted}</p>\n`;
            }
        }

        if (inList) html += '</ul>\n';
        if (inOList) html += '</ol>\n';
        if (inBlock) html += '</div>\n';
        if (inWrapper) html += '<p>&nbsp;</p>\n</div>';

        // Post-process icon placeholders
        iconPlaceholders.forEach(({ placeholder, icon }) => {
            const iconHTML = `<h3 class="dp-has-icon"><i class="${icon}"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>`;
            html = html.replace(placeholder + '<h3', iconHTML + '<h3');
            html = html.replace(`${iconHTML}<h3`, `${iconHTML}`); // Fix potential double h3 if regex was too broad
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
                // Check if the content is wrapped in a DesignPLUS Accordion, or a general DesignPLUS wrapper
                const wrapper = iframe.contentDocument.body; // Target the body to find either dp-wrapper or dp-panels-wrapper
                if (!wrapper) return alert('No DesignPLUS content found.');

                const accordionElement = wrapper.querySelector('.dp-panels-wrapper.dp-accordion-default');
                let md;
                if (accordionElement) {
                    md = `${DESIGN_WRAPPER_START}\n\n${convertAccordionToMarkdownPseudoTags(accordionElement)}${DESIGN_WRAPPER_END}\n`;
                } else {
                    // Fallback to existing convertToMarkdown if not an accordion
                    const dpWrapper = wrapper.querySelector('#dp-wrapper');
                    if (!dpWrapper) return alert('No DesignPLUS wrapper found.');
                    md = convertToMarkdown(dpWrapper);
                }

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
