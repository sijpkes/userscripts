// ==UserScript==
// @name         Canvas & H5P Sync Automation (Linker Edition)
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Link Canvas to H5P. UI elements are removed automatically on Save.
// @author       Paul
// @match        https://canvas.newcastle.edu.au/courses/*/pages/*/edit*
// @match        https://uonline.h5p.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        storageKey: 'h5p_sync_results',
        linkageKey: 'h5p_linkages',
        h5pFolderUrl: 'https://uonline.h5p.com/content/1292337588059941109'
    };

    const url = window.location.href;

    // Routing
    if (url.includes('canvas.newcastle.edu.au')) {
        initCanvasEditor();
    } else if (url.includes('h5p.com')) {
        if (url.includes('/content') && !url.includes('reports')) initH5PLinker();
    }

    // ========================================================================
    // PART 1: CANVAS EDITOR (Main World Injection & Ephemeral UI)
    // ========================================================================

    function initCanvasEditor() {
        const currentLinkages = GM_getValue(CONFIG.linkageKey, {});

        function pageScript(existingLinks, folderUrl) {
            console.log("H5P Linker: Editor script injected.");

            const checkEditor = setInterval(() => {
                if (window.tinyMCE && window.tinyMCE.activeEditor && window.tinyMCE.activeEditor.initialized) {
                    clearInterval(checkEditor);
                    setupEditorLinker(window.tinyMCE.activeEditor);
                }
            }, 1000);

            function setupEditorLinker(editor) {
                // IMPORTANT: Intercept the Save/GetContent process
                // This prevents the button/link from being saved into the Canvas DB
                editor.on('GetContent', (e) => {
                    const doc = new DOMParser().parseFromString(e.content, 'text/html');
                    const uiElements = doc.querySelectorAll('.h5p-linker-ui');
                    if (uiElements.length > 0) {
                        uiElements.forEach(el => el.remove());
                        e.content = doc.body.innerHTML;
                        console.log("H5P Linker: Cleaned UI from content before saving.");
                    }
                });

                // Poll for the H5P embed inside the editor iframe
                setInterval(() => {
                    const doc = editor.getDoc();
                    if (!doc) return;

                    const target = doc.querySelector('.dp-embed-wrapper') || doc.querySelector('.mce-preview-object');
                    if (!target || doc.querySelector('.h5p-linker-ui')) return;

                    const content = editor.getContent();
                    const uuidMatch = content.match(/resource_link_lookup_uuid=([^&"'\s]+)/);
                    if (!uuidMatch) return;
                    const uuid = uuidMatch[1];

                    let linkedH5PId = null;
                    for (const [id, data] of Object.entries(existingLinks)) {
                        if (data.uuid === uuid) {
                            linkedH5PId = id;
                            break;
                        }
                    }

                    // Create UI Container
                    const container = doc.createElement('div');
                    container.className = 'h5p-linker-ui';
                    container.setAttribute('contenteditable', 'false'); // Lock for editing
                    container.setAttribute('data-mce-bogus', 'all');   // TinyMCE hint to ignore
                    container.style = "margin: 10px 0; font-family: sans-serif; border: 1px solid #6c5ce7; padding: 8px; background: #f3f0ff; border-radius: 6px; display: inline-block; vertical-align: middle;";

                    if (linkedH5PId) {
                        // Display Link Status
                        const link = doc.createElement('a');
                        link.href = `https://uonline.h5p.com/content/${linkedH5PId}`;
                        link.target = "_blank";
                        link.innerText = `✅ Linked to H5P: ${linkedH5PId}`;
                        link.style = "color: #2e7d32; font-weight: bold; text-decoration: underline; font-size: 13px; margin-right: 10px;";
                        container.appendChild(link);

                        const resetBtn = doc.createElement('button');
                        resetBtn.innerText = 'Reset';
                        resetBtn.style = "font-size: 10px; background: #fff; border: 1px solid #ccc; cursor: pointer; padding: 2px 5px; border-radius: 3px;";
                        resetBtn.onclick = (e) => {
                            e.preventDefault();
                            window.dispatchEvent(new CustomEvent('H5P_LINK_RESET', { detail: { h5pId: linkedH5PId } }));
                        };
                        container.appendChild(resetBtn);
                    } else {
                        // Display Link Button
                        const btn = doc.createElement('button');
                        btn.type = 'button';
                        btn.innerText = '🔗 Link to Journal';
                        btn.style = "padding: 6px 12px; background-color: #6c5ce7; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;";
                        btn.onclick = (e) => {
                            e.preventDefault();
                            window.dispatchEvent(new CustomEvent('H5P_LINK_REQUEST', {
                                detail: {
                                    uuid: uuid,
                                    pageTitle: document.querySelector('input[name="title"]')?.value || "Untitled"
                                }
                            }));
                        };
                        container.appendChild(btn);
                    }
                    target.parentNode.insertBefore(container, target);
                }, 1000);
            }
        }

        const script = document.createElement('script');
        script.textContent = `(${pageScript.toString()})(${JSON.stringify(currentLinkages)}, "${CONFIG.h5pFolderUrl}");`;
        document.documentElement.appendChild(script);

        // Bridge Listeners
        window.addEventListener('H5P_LINK_REQUEST', (e) => {
            GM_setValue('pending_link', {
                uuid: e.detail.uuid,
                pageTitle: e.detail.pageTitle,
                timestamp: Date.now()
            });
            window.open(CONFIG.h5pFolderUrl, '_blank');
        });

        window.addEventListener('H5P_LINK_RESET', (e) => {
            let linkages = GM_getValue(CONFIG.linkageKey, {});
            delete linkages[e.detail.h5pId];
            GM_setValue(CONFIG.linkageKey, linkages);
            alert("Link Reset. Refresh Canvas to relink.");
        });
    }

    // ========================================================================
    // PART 2: H5P LINKER (On h5p.com content list)
    // ========================================================================

    async function initH5PLinker() {
        const pending = GM_getValue('pending_link', null);
        if (!pending || (Date.now() - pending.timestamp > 600000)) return addMergeButton();

        const breadcrumbs = await waitFor('.breadcrumbs-container');
        if (breadcrumbs) {
            const msg = document.createElement('div');
            msg.style = "margin: 15px 0; color: #d63031; font-weight: bold; padding: 15px; border: 3px dashed #d63031; background: #fff1f1; border-radius: 4px;";
            msg.innerHTML = `⚠️ LINKING MODE: Click an H5P title to map it to:<br><strong>"${pending.pageTitle}"</strong>`;
            breadcrumbs.after(msg);
        }

        const table = await waitFor('#content-table');
        table.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href.includes('/content/')) {
                const h5pId = link.href.split('/').pop();
                if (confirm(`Confirm link to "${pending.pageTitle}"?`)) {
                    let linkages = GM_getValue(CONFIG.linkageKey, {});
                    linkages[h5pId] = { uuid: pending.uuid, pageTitle: pending.pageTitle };
                    GM_setValue(CONFIG.linkageKey, linkages);
                    GM_setValue('pending_link', null);
                    alert("Linked! Close this tab and refresh Canvas.");
                    window.close();
                }
            }
        }, true);
    }

    // ========================================================================
    // PART 3: THE MERGE (On h5p.com)
    // ========================================================================

    function addMergeButton() {
        const check = setInterval(() => {
            const ul = document.querySelector('ul.content-links');
            if (ul && !document.getElementById('merge-btn-li')) {
                const li = document.createElement('li');
                li.id = 'merge-btn-li';
                li.innerHTML = '<a href="#" style="background: #2e7d32; color: #fff; font-weight:bold; border-radius: 4px; padding: 5px 10px;">Merge Canvas Data</a>';
                li.onclick = (e) => { e.preventDefault(); runH5PProcess(); };
                ul.appendChild(li);
            }
        }, 1000);
    }

    async function runH5PProcess() {
        const linkages = GM_getValue(CONFIG.linkageKey, {});
        if (Object.keys(linkages).length === 0) return alert("No linkages found.");

        const rows = Array.from(document.querySelectorAll('#content-table tbody tr'));
        let finalResults = [];

        for (const row of rows) {
            const h5pLink = row.querySelector('a[href*="/content/"]');
            if (!h5pLink) continue;

            const h5pId = h5pLink.href.split('/').pop();
            const linkData = linkages[h5pId];

            if (linkData) {
                console.log(`Scraping Reports for: ${linkData.pageTitle}`);
                h5pLink.click();
                
                const reportBtn = await waitFor('ul.content-links a[href*="reports"]');
                if (!reportBtn) { window.history.back(); continue; }
                reportBtn.click();

                const reportsTable = await waitFor('#reports-table');
                const userRows = Array.from(reportsTable.querySelectorAll('tbody tr'));
                let pageEntries = { uuid: linkData.uuid, title: linkData.pageTitle, h5pId: h5pId, submissions: [] };

                for (const uRow of userRows) {
                    const userLink = uRow.querySelector('td.browser-open-item > a');
                    if (!userLink) continue;

                    const titleAttr = uRow.querySelector('td.browser-open-item').getAttribute('title') || "";
                    const userEmail = (titleAttr.match(/\(([^)]+)\)/) || [null, "unknown"])[1];

                    userLink.click();
                    const responseSpan = await waitFor('span.h5p-fill-in-user-response');
                    if (responseSpan) {
                        pageEntries.submissions.push({ email: userEmail, response: responseSpan.innerText.trim() });
                    }
                    const back = document.querySelector('.h5p-sc-back-button, .back-button') || {click: () => window.history.back()};
                    back.click();
                    await waitFor('#reports-table');
                }
                finalResults.push(pageEntries);
                window.location.href = "https://uonline.h5p.com/content";
            }
        }
        GM_setValue(CONFIG.storageKey, finalResults);
        console.log("SYNC COMPLETE:", finalResults);
        alert("Success! All linked journal data merged. Check Console.");
    }

    // Helper Functions
    function delay(ms) { return new Promise(res => setTimeout(res, ms)); }
    async function waitFor(selector) {
        for (let i = 0; i < 20; i++) {
            const el = document.querySelector(selector);
            if (el) return el;
            await delay(500);
        }
        return null;
    }
})();