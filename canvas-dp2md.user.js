// ==UserScript==
// @name         Canvas DesignPlus to Markdown
// @namespace    http://tampermonkey.net/
// @version      1.2
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

    alert('loaded canvas-dp2md.user.js');

    const DESIGN_WRAPPER_START = '<<DESIGN PLUS WRAPPER START>>';
    const DESIGN_WRAPPER_END = '<<DESIGN PLUS WRAPPER END>>';
    const HEADER_START = '<<HEADER START>>';
    const HEADER_END = '<<HEADER END>>';
    const BLOCK_START = '<<CONTENT BLOCK START>>';
    const BLOCK_END = '<<CONTENT BLOCK END>>';
    const ICON_REGEX = /<<ICON\s+([^>]+)>>/;

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

    function convertToMarkdown(wrapper) {
        let md = `${DESIGN_WRAPPER_START}\n\n`;

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

        wrapper.querySelectorAll('.dp-content-block').forEach(block => {
            const blockId = block.getAttribute('data-id');
            if (blockId) md += `<!-- dp-id: ${blockId} -->\n`;
            md += `${BLOCK_START}\n\n`;

            const heading = block.querySelector('h3');
            if (heading) {
                const icon = heading.querySelector('i');
                if (icon) {
                    const iconClass = [...icon.classList].filter(c => c.startsWith('fa')).join(' ');
                    md += `<<ICON ${iconClass}>> `;
                }
                md += `### ${heading.textContent.trim()}\n\n`;
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

            block.querySelectorAll('ol').forEach(ul => {
                ul.querySelectorAll('li').forEach((li, i) => {
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

            // console.log('Line:', JSON.stringify(line));
            const iconHeaderMatch = line.match(ICON_HEADER_RE);
            // console.log('iconHeaderMatch:', iconHeaderMatch);
            if (iconHeaderMatch) {
                const icon = iconHeaderMatch[1];
                const heading = iconHeaderMatch[2];
                const placeholder = `<!-- ICON_PLACEHOLDER_${iconCounter} -->`;
                html += `${placeholder}<h3>${heading}</h3>\n`;
                //   console.log(html)
                iconPlaceholders.push({ placeholder, icon });
                iconCounter++;
                continue;
            }

            if (line.startsWith('### ')) {
                html += `<h3>${line.slice(4).trim()}</h3>\n`;
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

            if (line.startsWith('* ')) {
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
            html += `<p>${formatted}</p>\n`;
        }

        if (inList) html += '</ul>\n';
        if (inOList) html += '</ol>\n';
        if (inBlock) html += '</div>\n';
        if (inWrapper) html += '<p>&nbsp;</p>\n</div>';

        // Post-process icon placeholders
        iconPlaceholders.forEach(({ placeholder, icon }) => {
            const iconHTML = `<h3 class="dp-has-icon"><i class="${icon}"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>`;
            html = html.replace(placeholder + '<h3>', iconHTML);
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
                const wrapper = iframe.contentDocument.querySelector('#dp-wrapper');
                if (!wrapper) return alert('No DesignPLUS wrapper found.');
                const md = convertToMarkdown(wrapper);
                const fileName = getFileNameFromBreadcrumbs();
                downloadMarkdown(fileName, md);
                menu.style.display = 'none';
            });
        };

        option2.onclick = () => {
            uploadMarkdownFile(md => {
                const html = parseDesignPlusMarkdownToHTML(md);
                //console.dir(html)
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

