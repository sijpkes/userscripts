// ==UserScript==
// @name         Canvas H5P Inline Journal Manager
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Link Canvas to H5P. UI elements are removed automatically on Save.
// @author       Paul
// @match        https://canvas.newcastle.edu.au/courses/*/pages/*/edit*
// @match        https://uonline.h5p.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_log
// ==/UserScript==

(function () {
    'use strict';
    const MODE = 'Development';
    console.log(`H5P Inline Journal Manager Loaded. ${MODE}`);

    const CONFIG = {
        storageKey: 'h5p_sync_results',
        linkageKey: 'h5p_linkages',
        h5pFolderKey: 'h5p_folder_url',
        h5pFolderUrl: 'https://uonline.h5p.com/content/1292803062168661839',
        // State Machine Keys
        stateKey: 'h5p_scrape_running',
        queueKey: 'h5p_scrape_queue',
        debugLogKey: 'h5p_debug_log',
        checkingScrapeStateKey: 'h5p_checking_scrape_state',
        // Scraping progress keys
        scrapeStageKey: 'h5p_scrape_stage',
        scrapeCurrentH5pKey: 'h5p_scrape_current_h5p',
        scrapeCurrentPageKey: 'h5p_scrape_current_page',
        scrapeStudentIndexKey: 'h5p_scrape_student_index',
        scrapeStudentsKey: 'h5p_scrape_students',
    };

    const url = window.location.href;

    // Debug logging to persistent storage
    function debugLog(msg) {
        console.log(msg);
        const logs = GM_getValue(CONFIG.debugLogKey, []);
        logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        if (logs.length > 50) logs.shift(); // Keep only last 50 entries
        GM_setValue(CONFIG.debugLogKey, logs);
    }

    function clearDebugLog() {
        GM_setValue(CONFIG.debugLogKey, []);
    }

    function getDebugLog() {
        return GM_getValue(CONFIG.debugLogKey, []);
    }

    // ========================================================================
    // STATE MACHINE CONTROLLER (The logic that survives page loads)
    // ========================================================================

    async function checkScrapeState() {
        // Guard: prevent concurrent execution
        const isCurrentlyChecking = window.__h5p_checking_state;
        if (isCurrentlyChecking) {
            debugLog("checkScrapeState: Already running, skipping concurrent call");
            return;
        }
        window.__h5p_checking_state = true;
        
        try {
            const isRunning = GM_getValue(CONFIG.stateKey, false);
            if (!isRunning) return;

        const queue = GM_getValue(CONFIG.queueKey, []);
        const linkages = GM_getValue(CONFIG.linkageKey, {});
        const folderUrl = GM_getValue(CONFIG.h5pFolderKey, CONFIG.h5pFolderUrl);

        // MODE A: On the Main Folder Page
        if (url.startsWith(folderUrl) && document.querySelector('table.content-table')) {
            if (queue.length === 0) {
                debugLog("State Machine: Building Queue...");
                debugLog("DEBUG: All linkages: " + JSON.stringify(linkages));
                // Build queue from ALL linkages, not just visible table rows
                const newQueue = [];
                Object.entries(linkages).forEach(([id, data]) => {
                    newQueue.push({ id: id, url: `https://uonline.h5p.com/content/${id}` });
                });

                debugLog("DEBUG: Built queue with " + newQueue.length + " items: " + JSON.stringify(newQueue));
                if (newQueue.length === 0) {
                    alert("No linked H5P items found.");
                    GM_setValue(CONFIG.stateKey, false);
                    return;
                }
                GM_setValue(CONFIG.queueKey, newQueue);
                debugLog('State Machine: Queue built with ' + newQueue.length + ' items. Opening first: ' + newQueue[0].id);
                window.location.href = newQueue[0].url;
            } else {
                // Return trip from a previous item. Open next item in new tab.
                debugLog('State Machine: Return trip detected. Queue length: ' + queue.length + ', Next item: ' + queue[0].id);
                debugLog('Full queue: ' + JSON.stringify(queue));
                window.location.href = queue[0].url;
            }
        }

        // MODE B: On a specific H5P Content Page
        else if (!url.includes('/report') && !url.includes('/attempts') && !url.includes('/users/')) {
            debugLog("Mode B: Entering content page handler for URL: " + url);
            console.log("State Machine: On content page, checking for reports button...");
            
            // Try immediate lookup first
            let reportsBtn = document.querySelector('a.report-link');
            debugLog("Mode B: Direct querySelector found: " + (reportsBtn ? "YES" : "NO"));
            
            if (!reportsBtn) {
                debugLog("Mode B: Reports button not found immediately, waiting with observer...");
                reportsBtn = await waitForWithObserver('a.report-link', 5000);
            }
            
            debugLog("Mode B: After waiting, reportsBtn found: " + (reportsBtn ? "YES" : "NO"));
            async function waitForWithObserver(selector, timeout = 5000, context = document) {
                return new Promise((resolve) => {
                    const observer = new MutationObserver(() => {
                        const el = context.querySelector(selector);
                        if (el) {
                            observer.disconnect();
                            clearTimeout(timer);
                            resolve(el);
                        }
                    });

                    observer.observe(context, { childList: true, subtree: true });

                    const timer = setTimeout(() => {
                        observer.disconnect();
                        resolve(null);
                    }, timeout);
                });
            }
            console.log('State Machine: Current URL is', url);
            console.log('çurrent location is', window.location.href)
            if (reportsBtn) {
                console.log('State Machine: Reports button found, navigating to /report.');
                const reportUrl = url.endsWith('/') ? url + 'report' : url + '/report';
                debugLog('Mode B: Reports button found, navigating to: ' + reportUrl);
                window.location.href = reportUrl;
            } else {
                console.warn('State Machine: No reports button found on this content page. Skipping.');
                debugLog('Mode B: No reports button found after waiting. Skipping this item.');
                advanceQueue();
            }
        }
        // MODE C: On the actual Report Table Page
        else if (url.endsWith('/report')) {
            debugLog("Mode C: On report page, scraping reports...");
            console.log("State Machine: Scraping Table...");
            await scrapeReportPage();
        }
        
        // MODE D: During student scraping (attempts or attempt detail pages)
        else if (GM_getValue(CONFIG.scrapeStageKey)) {
            debugLog("Mode D: Continuing student scraping, stage: " + GM_getValue(CONFIG.scrapeStageKey));
            await continueStudentScraping();
        }
        } finally {
            window.__h5p_checking_state = false;
        }
    }

    async function scrapeReportPage() {
        const h5pId = url.split('/').slice(-2, -1)[0];
        const linkages = GM_getValue(CONFIG.linkageKey, {});
        const linkData = linkages[h5pId];
        
        debugLog('scrapeReportPage: Starting scrape for h5pId: ' + h5pId);

        // STAGE 1: Build student list
        const reportsTable = await waitFor('#reports-table tbody');
        if (!reportsTable) {
            debugLog('scrapeReportPage: Reports table not found, advancing queue');
            return advanceQueue();
        }

        const userRows = Array.from(reportsTable.querySelectorAll('tr'));
        debugLog('scrapeReportPage: Found ' + userRows.length + ' student rows');
        
        // Build student data list
        const students = [];
        for (const uRow of userRows) {
            const userCell = uRow.querySelector('td.browser-open-item.user');
            if (!userCell) continue;
            
            const titleAttr = userCell.getAttribute('title') || "";
            const username = userCell.querySelector('.fable-title')?.innerText.trim() || "Unknown";
            const userEmail = (titleAttr.match(/\(([^)]+)\)/) || [null, "unknown"])[1];
            const userLink = userCell.querySelector('a.fable-report');
            if (!userLink) continue;
            
            students.push({
                username: username,
                email: userEmail,
                userUrl: userLink.href
            });
        }
        
        debugLog('scrapeReportPage: Built student list with ' + students.length + ' students');
        
        // Store state and start scraping
        let pageEntries = { uuid: linkData.uuid, title: linkData.pageTitle, h5pId: h5pId, submissions: [] };
        GM_setValue(CONFIG.scrapeCurrentPageKey, pageEntries);
        GM_setValue(CONFIG.scrapeCurrentH5pKey, h5pId);
        GM_setValue(CONFIG.scrapeStudentsKey, students);
        GM_setValue(CONFIG.scrapeStudentIndexKey, 0);
        GM_setValue(CONFIG.scrapeStageKey, 'ATTEMPTS_LIST');
        
        // Navigate to first student
        window.location.href = students[0].userUrl;
    }
    
    async function continueStudentScraping() {
        const h5pId = GM_getValue(CONFIG.scrapeCurrentH5pKey);
        const students = GM_getValue(CONFIG.scrapeStudentsKey, []);
        const studentIndex = GM_getValue(CONFIG.scrapeStudentIndexKey, 0);
        const stage = GM_getValue(CONFIG.scrapeStageKey, 'REPORTS');
        
        if (stage === 'ATTEMPTS_LIST') {
            // We're on the attempts page - click the first attempt
            debugLog('continueStudentScraping: ATTEMPTS_LIST stage for student ' + studentIndex);
            
            const attemptsTable = await waitFor('#attempts-table tbody');
            if (!attemptsTable) {
                debugLog('continueStudentScraping: No attempts table found, skipping student');
                skipToNextStudent();
                return;
            }
            
            const attemptRows = attemptsTable.querySelectorAll('tr');
            if (attemptRows.length === 0) {
                debugLog('continueStudentScraping: No attempts found, skipping student');
                skipToNextStudent();
                return;
            }
            
            const attemptLink = attemptRows[0].querySelector('a.fable-attempt');
            if (!attemptLink) {
                debugLog('continueStudentScraping: No attempt link found, skipping student');
                skipToNextStudent();
                return;
            }
            
            debugLog('continueStudentScraping: Clicking attempt for student ' + studentIndex);
            GM_setValue(CONFIG.scrapeStageKey, 'ATTEMPT_DETAIL');
            attemptLink.click();
        } 
        else if (stage === 'ATTEMPT_DETAIL') {
            // We're on the attempt detail page - extract data
            debugLog('continueStudentScraping: ATTEMPT_DETAIL stage for student ' + studentIndex);
            
            await waitFor('table.report-view');
            
            const student = students[studentIndex];
            
            // Extract metadata
            let startTime = "";
            let endTime = "";
            let spent = "";
            const reportRows = document.querySelectorAll('table.report-view tbody tr');
            for (const row of reportRows) {
                const th = row.querySelector('th');
                const td = row.querySelector('td');
                if (!th || !td) continue;
                const label = th.innerText.trim().toLowerCase();
                const value = td.innerText.trim();
                if (label.includes('start time')) startTime = value;
                if (label.includes('end time')) endTime = value;
                if (label.includes('spent')) spent = value;
            }
            
            // Extract response
            let responseText = "";
            const responseSpan = document.querySelector('span.h5p-fill-in-user-response');
            if (responseSpan) {
                responseText = responseSpan.innerText.trim();
            }
            
            debugLog('continueStudentScraping: Extracted data for ' + student.username);
            
            // Store the submission
            let pageEntries = GM_getValue(CONFIG.scrapeCurrentPageKey);
            pageEntries.submissions.push({
                username: student.username,
                email: student.email,
                textContent: responseText,
                startTime: startTime,
                endTime: endTime,
                spent: spent
            });
            GM_setValue(CONFIG.scrapeCurrentPageKey, pageEntries);
            
            // Move to next student
            skipToNextStudent();
        }
    }
    
    async function skipToNextStudent() {
        const students = GM_getValue(CONFIG.scrapeStudentsKey, []);
        let studentIndex = GM_getValue(CONFIG.scrapeStudentIndexKey, 0);
        studentIndex++;
        
        if (studentIndex < students.length) {
            debugLog('continueStudentScraping: Moving to student ' + studentIndex);
            GM_setValue(CONFIG.scrapeStudentIndexKey, studentIndex);
            GM_setValue(CONFIG.scrapeStageKey, 'ATTEMPTS_LIST');
            window.location.href = students[studentIndex].userUrl;
        } else {
            // All students done
            debugLog('continueStudentScraping: All students processed');
            const pageEntries = GM_getValue(CONFIG.scrapeCurrentPageKey);
            const allResults = GM_getValue(CONFIG.storageKey, []);
            allResults.push(pageEntries);
            GM_setValue(CONFIG.storageKey, allResults);
            
            // Clear scraping state
            GM_setValue(CONFIG.scrapeCurrentH5pKey, null);
            GM_setValue(CONFIG.scrapeStudentsKey, []);
            GM_setValue(CONFIG.scrapeStudentIndexKey, 0);
            GM_setValue(CONFIG.scrapeStageKey, null);
            GM_setValue(CONFIG.scrapeCurrentPageKey, null);
            
            advanceQueue();
        }
    }

    async function advanceQueue() {
        let queue = GM_getValue(CONFIG.queueKey, []);
        debugLog('State Machine: Advancing Queue. Items left before removal: ' + queue.length);
        debugLog('Called from: ' + new Error().stack.split('\n')[2]);
        debugLog('Queue before shift: ' + JSON.stringify(queue));
        queue.shift();
        debugLog('Queue after shift: ' + JSON.stringify(queue));
        GM_setValue(CONFIG.queueKey, queue);

        if (queue.length > 0) {
            // More items to process. Go back to folder to fetch the next item.
            debugLog('State Machine: Item done, returning to folder for next item.');
            const url = GM_getValue(CONFIG.h5pFolderKey, CONFIG.h5pFolderUrl);
            debugLog('Navigating to folder: ' + url);
            window.location.href = url;
        } else {
            // All done. Clear running state.
            debugLog('State Machine: Queue complete.');
            GM_setValue(CONFIG.stateKey, false);
            GM_setValue('h5p_current_target', null);
            const final = GM_getValue(CONFIG.storageKey, []);
            debugLog("SYNC COMPLETE: " + JSON.stringify(final));
            alert("Success! All linked journal data merged. Check Storage Logs.");
        }
    }

    // ========================================================================
    // PART 1: UI INJECTION (Slide-out UI)
    // ========================================================================

    function injectSlideOutUI() {
        if (window.parent !== window) return;
        if (document.getElementById('h5p-slide-tab')) return;

        const storedFolder = GM_getValue(CONFIG.h5pFolderKey, CONFIG.h5pFolderUrl);

        const tab = document.createElement('div');
        tab.id = 'h5p-slide-tab';
        tab.style.cssText = 'position: fixed; top: 80px; right: 0; width: 320px; max-width: 85vw; height: calc(100vh - 100px); background: #ffffff; box-shadow: 0 8px 24px rgba(0,0,0,0.15); border-left: 1px solid rgba(0,0,0,0.08); transform: translateX(100%); transition: transform 300ms ease; z-index: 2147483647; font-family: sans-serif; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box;';

        const toggle = document.createElement('button');
        toggle.id = 'h5p-slide-toggle';
        toggle.textContent = '⟨ H5P';
        toggle.style.cssText = 'position: absolute; left: -62px; top: 8px; width: 60px; height: 30px; background: #6c5ce7; color: #fff; border: none; border-radius: 4px 4px 0 0; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.12)';

        const body = document.createElement('div');
        body.style.flex = '1 1 auto';
        body.style.overflow = 'auto';

        const folderInput = document.createElement('input');
        folderInput.type = 'text';
        folderInput.value = storedFolder;
        folderInput.style.cssText = 'width:100%;padding:6px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Config';
        saveBtn.style.cssText = 'flex:1;padding:8px;background:#2e7d32;color:#fff;border:none;border-radius:4px;cursor:pointer;';
        saveBtn.onclick = () => {
            GM_setValue(CONFIG.h5pFolderKey, folderInput.value.trim());
            alert('Config saved.');
        };

        const mergeBtn = document.createElement('button');
        mergeBtn.textContent = 'Merge Data';
        mergeBtn.style.cssText = 'flex:1;padding:8px;background:#6c5ce7;color:#fff;border:none;border-radius:4px;cursor:pointer;';
        mergeBtn.onclick = () => {
            if (confirm("Start merging data from linked H5Ps? This page will refresh.")) {
                GM_setValue(CONFIG.storageKey, []);
                GM_setValue(CONFIG.queueKey, []);
                GM_setValue(CONFIG.stateKey, true);
                const url = GM_getValue(CONFIG.h5pFolderKey, CONFIG.h5pFolderUrl);
                window.open(url, '_blank')
            }
        };

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'margin-top:12px;display:flex;gap:8px;';
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(mergeBtn);

        body.appendChild(folderInput);
        body.appendChild(btnRow);
        tab.appendChild(toggle);
        tab.appendChild(body);
        document.documentElement.appendChild(tab);

        let open = false;
        toggle.addEventListener('click', () => {
            open = !open;
            tab.style.transform = open ? 'translateX(0)' : 'translateX(100%)';
            toggle.textContent = open ? 'H5P ⟩' : '⟨ H5P';
        });
    }

    // ========================================================================
    // PART 2: CANVAS EDITOR & H5P LINKER (Fixed Reset Button)
    // ========================================================================

    function initCanvasEditor() {
        const currentLinkages = GM_getValue(CONFIG.linkageKey, {});
        const currentFolderUrl = GM_getValue(CONFIG.h5pFolderKey, CONFIG.h5pFolderUrl);

        function pageScript(existingLinks, folderUrl) {
            const checkEditor = setInterval(() => {
                if (window.tinyMCE && window.tinyMCE.activeEditor && window.tinyMCE.activeEditor.initialized) {
                    clearInterval(checkEditor);
                    setupEditorLinker(window.tinyMCE.activeEditor);
                }
            }, 1000);

            function setupEditorLinker(editor) {
                editor.on('GetContent', (e) => {
                    const doc = new DOMParser().parseFromString(e.content, 'text/html');
                    const uiElements = doc.querySelectorAll('.h5p-linker-ui');
                    if (uiElements.length > 0) {
                        uiElements.forEach(el => el.remove());
                        e.content = doc.body.innerHTML;
                    }
                });

                setInterval(() => {
                    const doc = editor.getDoc();
                    if (!doc) return;

                    // Find the H5P embed
                    const target = doc.querySelector('.dp-embed-wrapper') || doc.querySelector('.mce-preview-object');
                    if (!target || doc.querySelector('.h5p-linker-ui')) return;

                    const content = editor.getContent();
                    const uuidMatch = content.match(/resource_link_lookup_uuid=([^&"'\s]+)/);
                    if (!uuidMatch) return;
                    const uuid = uuidMatch[1];

                    let linkedH5PId = null;
                    for (const [id, data] of Object.entries(existingLinks)) {
                        if (data.uuid === uuid) { linkedH5PId = id; break; }
                    }

                    const container = doc.createElement('div');
                    container.className = 'h5p-linker-ui';
                    container.setAttribute('contenteditable', 'false');
                    container.style = "margin: 10px 0; font-family: sans-serif; border: 1px solid #6c5ce7; padding: 8px; background: #f3f0ff; border-radius: 6px; display: inline-block; vertical-align: middle;";

                    if (linkedH5PId) {
                        const label = doc.createElement('span');
                        label.style = "color: #2e7d32; font-weight: bold; font-size: 13px; margin-right: 10px;";
                        label.innerText = `✅ Linked H5P: ${linkedH5PId}`;
                        container.appendChild(label);

                        const resetBtn = doc.createElement('button');
                        resetBtn.type = 'button';
                        resetBtn.innerText = 'Reset';
                        resetBtn.style = "font-size: 10px; background: #fff; border: 1px solid #ccc; cursor: pointer; padding: 2px 5px; border-radius: 3px;";
                        resetBtn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // CRITICAL: Dispatch to parent.window because we are inside an iframe
                            const targetWin = window.parent || window;
                            targetWin.dispatchEvent(new CustomEvent('H5P_LINK_RESET', {
                                detail: { h5pId: linkedH5PId }
                            }));
                        };
                        container.appendChild(resetBtn);
                    } else {
                        const btn = doc.createElement('button');
                        btn.type = 'button';
                        btn.innerText = '🔗 Link to Journal';
                        btn.style = "padding: 6px 12px; background-color: #6c5ce7; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;";
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const targetWin = window.parent || window;
                            targetWin.dispatchEvent(new CustomEvent('H5P_LINK_REQUEST', {
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
        script.textContent = `(${pageScript.toString()})(${JSON.stringify(currentLinkages)}, "${currentFolderUrl}");`;
        document.documentElement.appendChild(script);

        // Bridge Listeners (These live in the main window)
        window.addEventListener('H5P_LINK_REQUEST', (e) => {
            GM_setValue('pending_link', {
                uuid: e.detail.uuid,
                pageTitle: e.detail.pageTitle,
                timestamp: Date.now()
            });
            window.open(GM_getValue(CONFIG.h5pFolderKey, CONFIG.h5pFolderUrl), '_blank');
        });

        window.addEventListener('H5P_LINK_RESET', (e) => {
            let linkages = GM_getValue(CONFIG.linkageKey, {});
            delete linkages[e.detail.h5pId];
            GM_setValue(CONFIG.linkageKey, linkages);
            alert("Link Reset. Click ok to refresh Canvas page.");
            window.location.reload();
        });
    }

    async function initH5PLinker() {
        const pending = GM_getValue('pending_link', null);
        if (!pending || (Date.now() - pending.timestamp > 600000)) return;

        const breadcrumbs = await waitFor('.breadcrumbs-container');
        if (breadcrumbs) {
            const msg = document.createElement('div');
            msg.style = "margin: 15px 0; color: #d63031; font-weight: bold; padding: 15px; border: 3px dashed #d63031; background: #fff1f1; border-radius: 4px;";
            msg.innerHTML = `⚠️ LINKING MODE: Click an H5P title to map it to: <strong>"${pending.pageTitle}"</strong>`;
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
                    alert("Linked! Close and refresh Canvas.");
                    window.close();
                }
            }
        }, true);
    }

    // ========================================================================
    // INITIALIZATION & HELPERS
    // ========================================================================

    try {
        if (url.includes('canvas.newcastle.edu.au')) {
            injectSlideOutUI();
            initCanvasEditor();
        } else if (url.includes('h5p.com')) {
            injectSlideOutUI();
            // Delay checkScrapeState to allow DOM to fully load
            setTimeout(() => {
                debugLog("Calling checkScrapeState after page load delay");
                checkScrapeState();
            }, 1000);
            if (url.includes('/content') && !url.includes('reports')) initH5PLinker();
        }
    } catch (e) {
        console.error("H5P Script Error:", e);
        debugLog("ERROR: " + e.message);
    }

    async function waitFor(selector, context = document) {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const el = context.querySelector(selector);
                if (el) { clearInterval(interval); resolve(el); }
            }, 100);
        });
    }
})();