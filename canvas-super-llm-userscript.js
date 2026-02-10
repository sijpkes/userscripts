window.cvsllm_script_loaded = false;
window.cvsllm_script = function() {
    
    if (window.cvsllm_script_loaded) {
        console.log('Canvas Super LLM Userscript: Script already loaded, skipping re-initialization.');
        return;
    }
    window.cvsllm_script_loaded = true;

    // --- Core Configuration & Key Constants ---
    const CONFIG = {
        // --- API Keys (Stored by KeyManager in GM storage) ---
        KEY_GEMINI: 'hct_key_gemini',
        KEY_CANVAS: 'hct_key_canvas',
        YEAR: 2026,
        useOutlineCache: false,
        handbookURLtemplate: 'https://handbook.newcastle.edu.au/course/{year}/{courseCode}',

        // --- API URL Template (Key appended at runtime) ---
        apiUrlTemplate: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=`,

        // --- General Constants ---
        MAX_CONTENT_LENGTH: 10000,
        MAX_OUTLINE_LENGTH: 5000,
        MAX_RETRIES: 5,
        ONE_DAY_MS: 24 * 60 * 60 * 1000,
        CACHE_DURATION_MS: 24 * 60 * 60 * 1000, // 1 day

        // Caching Keys
        CACHE_KEY_CONTENT: 'llm_heading_course_outline_content_',
        CACHE_KEY_TIMESTAMP: 'llm_heading_course_outline_timestamp_',
        CACHE_KEY_MODULE_DATA: 'hct_module_data_',
    };


    // --- Global Utility Functions (Shared by all modules) ---

    const Utils = (function () {
        /**
         * Extracts the course ID from the current URL.
         * @returns {string | null} The course ID or null if not found.
         */
        function getCourseId() {
            const match = window.location.href.match(/\/courses\/(\d+)/);
            return match ? match[1] : null;
        }

        /**
         * Extracts the course code from the breadcrumbs.
         * @param {string} course_id
         * @returns {string | null} The course code or null.
         */
        function getCourseCode(course_id) {
            const element = document.querySelector(`#breadcrumbs a[href*='courses/${course_id}']`)
            return element ? element.textContent.split(' ')[0] : null
        }

        /**
         * Extracts the base URL for the Canvas domain.
         * @returns {string | null} The base URL or null.
         */
        function getCanvasBaseUrl() {
            const match = window.location.href.match(/(https?:\/\/[^\/]+)/);
            return match ? match[0] : null;
        }

        /**
         * Converts a delay in seconds into a human-readable format.
         * @param {number} delaySeconds
         * @returns {string}
         */
        function formatDelay(delaySeconds) {
            return delaySeconds >= 1 ? `${delaySeconds.toFixed(0)}s` : `${(delaySeconds * 1000).toFixed(0)}ms`;
        }

        /**
         * Helper to pause execution for a given time.
         * @param {number} ms - Milliseconds to wait.
         */
        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        /**
         * Copies text to the clipboard using the execCommand method.
         * @param {string} text - The text to copy.
         */
        function copyToClipboard(text) {
            const tempInput = document.createElement('textarea');
            tempInput.value = text;
            tempInput.style.position = 'absolute';
            tempInput.style.left = '-9999px';
            document.body.appendChild(tempInput);
            tempInput.select();
            try {
                return document.execCommand('copy');
            } catch (err) {
                console.error('Copy failed:', err);
                return false;
            } finally {
                document.body.removeChild(tempInput);
            }
        }

        /**
         * Creates and displays a floating UI element.
         * @param {string} content - HTML content or plain text to display.
         * @param {string} type - 'loading', 'success', or 'error'.
         * @param {string} [title="Generated Heading:"] - The title for a success message.
         * @param {boolean} [isCopiedContent=true] - If true, displays the copy button.
         */
        function showNotification(content, type, title = "Notification:", isCopiedContent = true) {
            let notification = document.getElementById('llm-heading-notification');

            if (!notification) {
                notification = document.createElement('div');
                notification.id = 'llm-heading-notification';
                Object.assign(notification.style, {
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    zIndex: '10000',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontFamily: 'system-ui, sans-serif',
                    fontSize: '16px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    transition: 'opacity 0.5s, transform 0.5s',
                    transform: 'translateY(0)',
                    cursor: 'pointer',
                    maxWidth: '400px',
                    textAlign: 'left'
                });
                document.body.appendChild(notification);
                notification.addEventListener('click', () => notification.remove());
            }

            let backgroundColor, textColor;
            switch (type) {
                case 'loading': backgroundColor = '#4a90e2'; textColor = 'white'; break;
                case 'success': backgroundColor = '#4CAF50'; textColor = 'white'; break;
                case 'error': backgroundColor = '#F44336'; textColor = 'white'; break;
                default: backgroundColor = '#333'; textColor = 'white';
            }

            Object.assign(notification.style, {
                backgroundColor: backgroundColor,
                color: textColor,
                border: type === 'loading' ? '2px solid #fff' : 'none',
            });

            let innerContent = '';
            if (type === 'success') {
                const copyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

                // Convert list content (like from keyTakeaways array) to a friendly HTML list
                let displayContent = content;
                let textToCopy = content;

                // Heuristic to detect array/list-like content from a string for better display
                if (content && (content.includes('*') || content.includes('•') || content.includes('1.'))) {
                    displayContent = content.split('\n').map(line => line.trim()).filter(line => line.length > 0).map(line => `<li>${line.replace(/^[*-•\d\.]+\s*/, '')}</li>`).join('');
                    displayContent = `<ul style="margin: 5px 0 0 15px; padding: 0; list-style-type: disc; font-size: 14px;">${displayContent}</ul>`;
                    textToCopy = content.replace(/<br\s*\/?>/g, '\n'); // Ensure text to copy is plain text
                } else {
                    displayContent = (content || '').toString().replace(/\n/g, '<br/>');
                    textToCopy = (content || '').toString().replace(/<br\s*\/?>/g, '\n');
                }


                innerContent = `
                    <strong style="display:block; margin-bottom: 5px;">SUCCESS:</strong> <span style="font-weight: bold; display: block; margin-bottom: 8px;">${title}</span>
                    <div style="font-size: 14px;">${displayContent}</div>
                    ${isCopiedContent ? `<span id="llm-copy-button" title="Copy to clipboard" style="cursor: pointer; display: flex; align-items: center; justify-content: flex-start; gap: 8px; margin-top: 10px; padding: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); width: fit-content;" data-copy-text="${encodeURIComponent(textToCopy)}">
                        ${copyIconSvg} Copy Full Text
                    </span>` : ''}
                `;
            } else {
                innerContent = `<strong>${type.toUpperCase()}:</strong> ${content}`;
            }

            notification.innerHTML = innerContent;

            // Attach copy listener only if it's a success message and has copy content
            if (type === 'success' && isCopiedContent) {
                const copyButton = document.getElementById('llm-copy-button');
                if (copyButton) {
                    copyButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Get text from data attribute
                        const textToCopy = decodeURIComponent(copyButton.getAttribute('data-copy-text'));
                        const success = copyToClipboard(textToCopy);

                        if (success) {
                            const originalContent = copyButton.innerHTML;
                            copyButton.innerHTML = `<span style="color: #ffeb3b; font-size: 12px; font-weight: bold;">COPIED!</span>`;
                            setTimeout(() => { copyButton.innerHTML = originalContent; }, 1500);
                        } else {
                            showNotification('Copy failed. Try manually.', 'error', '', false); // Do not show copy button on copy failure message
                        }
                    });
                }
            }

            // Auto-hide success/error messages after 8 seconds
            if (type !== 'loading') {
                setTimeout(() => {
                    Object.assign(notification.style, { opacity: '0', transform: 'translateY(-20px)' });
                    setTimeout(() => notification.remove(), 500);
                }, 8000);
            }
        }

        /**
         * Executes an API call with exponential backoff for resilience.
         * @param {object} payload - The request body.
         * @param {string} geminiKey - The Gemini API key.
         * @returns {Promise<object>} The JSON response from the API.
         */
        async function fetchWithBackoff(payload, geminiKey) {
            const apiUrl = `${CONFIG.apiUrlTemplate}${geminiKey}`;
            let delay = 1000; // 1 second starting delay
            let lastError = null;

            for (let i = 0; i < CONFIG.MAX_RETRIES; i++) {
                try {
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        return response.json();
                    }

                    // If it's a 429 (Too Many Requests) or 5xx, we should retry.
                    if (response.status === 429 || response.status >= 500) {
                        lastError = new Error(`API Error: ${response.statusText}. Retrying in ${formatDelay(delay / 1000)}...`);
                        await sleep(delay);
                        delay *= 2; // Exponential backoff
                    } else {
                        // Non-recoverable error (e.g., 400 Bad Request)
                        const errorJson = await response.json();
                        throw new Error(`Non-retryable API Error (${response.status}): ${JSON.stringify(errorJson)}`);
                    }
                } catch (error) {
                    lastError = error;
                    // If it's a network error on initial try, wait and retry
                    if (i < CONFIG.MAX_RETRIES - 1) {
                        await sleep(delay);
                        delay *= 2;
                    }
                }
            }
            // If loop finishes without success
            throw new Error(`Failed to fetch after ${CONFIG.MAX_RETRIES} attempts. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
        }

        function toCamelCaseKey(str) {
            // Remove non-alphanumeric characters (except spaces) and trim.
            const cleanStr = str.replace(/[^a-zA-Z0-9\s]/g, '').trim();
            return cleanStr.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase());
        }

        async function scrapeLayoutDomFromUrl(url) {
            return new Promise((resolve, reject) => {
                const tab = window.open(url, '_blank');

                if (!tab) {
                    reject('Failed to open new tab');
                    return;
                }

                const onLoad = () => {
                    try {
                        const observer = new tab.MutationObserver((mutations, obs) => {
                            const layoutDiv = tab.document.querySelector('div.layout');
                            if (layoutDiv) {
                                obs.disconnect();

                                const parser = new tab.DOMParser();
                                const dom = parser.parseFromString(layoutDiv.outerHTML, 'text/html');

                                tab.close();
                                resolve(dom);
                            }
                        });

                        observer.observe(tab.document.body, {
                            childList: true,
                            subtree: true,
                        });
                    } catch (err) {
                        reject('Error accessing tab content: ' + err.message);
                    }
                };

                tab.addEventListener('load', onLoad);
            });
        }

        // Expose public utility functions
        return {
            getCourseId,
            getCourseCode,
            getCanvasBaseUrl,
            fetchWithBackoff,
            showNotification,
            sleep,
            formatDelay,
            toCamelCaseKey,
            scrapeLayoutDomFromUrl
        };
        return { init };
    })();


    // ----------------------------------------------------------------------
    // --- 0. API Key Manager Module ---
    // ----------------------------------------------------------------------

    const KeyManager = (function (Utils) {
        const MODAL_ID = 'hct-key-input-modal';
        let resolver = null;

        /** Creates and displays a modal requesting a key. */
        function showKeyInputModal(keyName, keyLabel, helpUrl) {
            return new Promise((resolve) => {
                resolver = resolve;

                const existingModal = document.getElementById(MODAL_ID);
                if (existingModal) existingModal.remove();

                const modalHTML = `
                    <div id="${MODAL_ID}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); z-index: 10002; display: flex; justify-content: center; align-items: center; font-family: system-ui, sans-serif;">
                        <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3); max-width: 450px; width: 90%;">
                            <h3 style="margin-top: 0; color: #cc0000;">⚠️ ${keyLabel} Required</h3>
                            <p>This feature requires a valid **${keyLabel}** to function.</p>
                            <p style="font-size: 14px;">Paste your token below. It will be saved securely using <code>GM.setValue</code>.</p>

                            <input type="password" id="hct-key-input" placeholder="Paste your Access Token/API Key here..." data-key-name="${keyName}"
                                style="width: 100%; padding: 10px; margin: 15px 0; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">

                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <a href="${helpUrl}" target="_blank" style="color: #007bff; text-decoration: none; font-size: 14px;">[How to get this key?]</a>
                                <div>
                                    <button id="hct-cancel-btn" style="padding: 10px 15px; background: #ccc; color: #333; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">Cancel</button>
                                    <button id="hct-save-btn" style="padding: 10px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Key</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                document.body.insertAdjacentHTML('beforeend', modalHTML);

                const modal = document.getElementById(MODAL_ID);
                const input = document.getElementById('hct-key-input');
                const saveBtn = document.getElementById('hct-save-btn');
                const cancelBtn = document.getElementById('hct-cancel-btn');

                // Set initial focus
                input.focus();

                // Keyboard shortcut (ESCAPE)
                const handleKeydown = (e) => {
                    if (e.key === 'Escape') {
                        modal.remove();
                        resolver(null);
                        document.removeEventListener('keydown', handleKeydown); // Clean up
                    }
                };
                document.addEventListener('keydown', handleKeydown);


                // Handlers
                saveBtn.onclick = async () => {
                    document.removeEventListener('keydown', handleKeydown);
                    const key = input.value.trim();
                    if (key) {
                        await GM.setValue(keyName, key);
                        modal.remove();
                        resolver(key);
                        Utils.showNotification(`${keyLabel} saved successfully!`, 'success', `${keyLabel} Saved`);
                    } else {
                        input.style.border = '2px solid red';
                        Utils.showNotification('Key cannot be empty!', 'error');
                    }
                };

                cancelBtn.onclick = () => {
                    document.removeEventListener('keydown', handleKeydown);
                    modal.remove();
                    resolver(null);
                    Utils.showNotification(`Operation cancelled. ${keyLabel} is required for this feature.`, 'error');
                };
            });
        }


        /**
         * Main entry point to retrieve a key from storage or request it from the user.
         */
        async function getOrRequestKey(keyName, keyLabel, helpUrl = 'https://docs.gemini.google.com/tutorials/get-api-key') {
            let key = await GM.getValue(keyName, null);

            if (!key) {
                Utils.showNotification(`Missing ${keyLabel}. Please enter it in the pop-up.`, 'error');
                key = await showKeyInputModal(keyName, keyLabel, helpUrl);
            }

            return key;
        }

        /** Clears a specific key from GM storage. */
        async function clearKey(keyName, keyLabel) {
            await GM.deleteValue(keyName);
            Utils.showNotification(`${keyLabel} has been cleared from storage.`, 'success', 'Key Cleared');
        }

        /** Opens unified settings modal for Gemini + Canvas keys */
        async function openSettings() {
            const existing = document.getElementById('hct-settings-modal');
            if (existing) existing.remove();

            const geminiKey = await GM.getValue(CONFIG.KEY_GEMINI, null);
            const canvasKey = await GM.getValue(CONFIG.KEY_CANVAS, null);

            const modalHTML = `
                <div id="hct-settings-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10003; display: flex; justify-content: center; align-items: center; font-family: system-ui, sans-serif;">
                    <div style="background: white; padding: 22px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); width: 520px; max-width: 95%;">
                        <h3 style="margin-top: 0; color: #007bff;">Settings — API Keys</h3>
                        <p style="margin-top: 0; font-size: 13px;">Manage your Gemini and Canvas API keys. Keys are stored locally via <code>GM.setValue</code>.</p>

                        <div style="display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin-top: 12px;">
                            <div>
                                <div style="font-size: 13px; font-weight: 600;">Gemini API Key</div>
                                <div id="hct-gemini-status" style="font-size: 13px; color: ${geminiKey ? '#2f855a' : '#cc0000'};">${geminiKey ? 'Saved (********)' : 'Missing'}</div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button id="hct-gemini-enter" style="padding: 8px 12px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer;">Enter / Re-enter</button>
                                <button id="hct-gemini-clear" style="padding: 8px 12px; background:#e53e3e; color:white; border:none; border-radius:4px; cursor:pointer;">Clear</button>
                            </div>

                            <div style="grid-column: 1 / -1; height: 1px; background: #f0f0f0; margin: 8px 0;"></div>

                            <div>
                                <div style="font-size: 13px; font-weight: 600;">Canvas API Key</div>
                                <div id="hct-canvas-status" style="font-size: 13px; color: ${canvasKey ? '#2f855a' : '#cc0000'};">${canvasKey ? 'Saved (********)' : 'Missing'}</div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button id="hct-canvas-enter" style="padding: 8px 12px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer;">Enter / Re-enter</button>
                                <button id="hct-canvas-clear" style="padding: 8px 12px; background:#e53e3e; color:white; border:none; border-radius:4px; cursor:pointer;">Clear</button>
                            </div>
                        </div>

                        <div style="display:flex; justify-content: flex-end; gap:10px; margin-top: 18px;">
                            <button id="hct-settings-close" style="padding:8px 12px; border-radius:4px; background:#ccc; border:none; cursor:pointer;">Close</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            document.getElementById('hct-settings-close').addEventListener('click', () => {
                const el = document.getElementById('hct-settings-modal');
                if (el) el.remove();
            });

            document.getElementById('hct-gemini-enter').addEventListener('click', async () => {
                const newKey = await showKeyInputModal(CONFIG.KEY_GEMINI, 'Gemini API Key', 'https://docs.gemini.google.com/tutorials/get-api-key');
                if (newKey) {
                    document.getElementById('hct-gemini-status').textContent = 'Saved (********)';
                    document.getElementById('hct-gemini-status').style.color = '#2f855a';
                }
            });

            document.getElementById('hct-gemini-clear').addEventListener('click', async () => {
                await clearKey(CONFIG.KEY_GEMINI, 'Gemini API Key');
                document.getElementById('hct-gemini-status').textContent = 'Missing';
                document.getElementById('hct-gemini-status').style.color = '#cc0000';
            });

            document.getElementById('hct-canvas-enter').addEventListener('click', async () => {
                const newKey = await showKeyInputModal(CONFIG.KEY_CANVAS, 'Canvas API Key', 'https://canvas.instructure.com/doc/api/tokens.html');
                if (newKey) {
                    document.getElementById('hct-canvas-status').textContent = 'Saved (********)';
                    document.getElementById('hct-canvas-status').style.color = '#2f855a';
                }
            });

            document.getElementById('hct-canvas-clear').addEventListener('click', async () => {
                await clearKey(CONFIG.KEY_CANVAS, 'Canvas API Key');
                document.getElementById('hct-canvas-status').textContent = 'Missing';
                document.getElementById('hct-canvas-status').style.color = '#cc0000';
            });
        }

        return {
            getOrRequestKey,
            clearKey,
            openSettings
        };
    })(Utils);


    /**
     * CourseOutline module — robust implementation to scrape handbook pages,
     * call Gemini to extract structured fields, and cache results via GM storage.
     */
    const CourseOutline = (function () {

        /**
         * Calls Gemini with exponential backoff via Utils.fetchWithBackoff.
         * Builds a JSON schema-based request and returns the parsed JSON object.
         */
        async function _fetchCourseOutline(courseId, courseCode, url, geminiKey) {
            if (!courseCode && !courseId) throw new Error('courseCode or courseId required.');

            // Build handbook URL if not provided
            if (!url && courseCode) {
                url = CONFIG.handbookURLtemplate.replace('{year}', CONFIG.YEAR).replace('{courseCode}', courseCode);
            }

            // Ensure we have a Gemini key
            if (!geminiKey) {
                geminiKey = await KeyManager.getOrRequestKey(CONFIG.KEY_GEMINI, 'Gemini API Key');
                if (!geminiKey) throw new Error('Gemini API key required to fetch course outline.');
            }

            // Scrape the target URL's layout DOM
            const dom = await Utils.scrapeLayoutDomFromUrl(url);
            if (!dom) throw new Error('Failed to retrieve remote document DOM.');

            console.log(dom)
            // Attempt to extract a sensible title
            const titleEl = dom.querySelector('h1.course-title, h1, .course-title');
            const courseTitle = titleEl ? titleEl.textContent.trim() : (courseCode || 'Title Not Found');

            // Extract main textual content
            const mainEl = dom.querySelector('div.layout') || dom.body;
            const rawText = (mainEl && (mainEl.textContent || mainEl.innerText)) ? (mainEl.textContent || mainEl.innerText) : '';
            if (!rawText || rawText.trim().length === 0) {
                throw new Error('Could not extract text content from remote page.');
            }

            const truncatedText = rawText.substring(0, CONFIG.MAX_CONTENT_LENGTH);

            // Build schema properties dynamically for typical handbook headings
            const headingList = ['Course description', 'Course content', 'Learning outcomes', 'Assessments'];
            const schemaProperties = {
                courseTitle: { type: "STRING", description: "The course title, extracted from the page header." },
                courseCode: { type: "STRING", description: "The course code (e.g., 'GSBS6005')." },
                url: { type: "STRING", description: "The source URL of the handbook page." },
                courseSchedule: { type: "ARRAY", items: { type: "STRING" }, description: "Summarized schedule/availability/contact hours." }
            };
            const propertyOrdering = ["courseTitle", "courseCode", "url", "courseSchedule"];

            headingList.forEach(h => {
                const key = Utils.toCamelCaseKey(h); // e.g., courseDescription
                if (key === 'learningOutcomes' || key === 'assessments') {
                    schemaProperties[key] = {
                        type: "ARRAY",
                        items: { type: "STRING" },
                        description: `List of ${h}. Each list item should be a single string entry. Should be an empty array [] if not found.`
                    };
                } else {
                    schemaProperties[key] = {
                        type: "STRING",
                        description: `Extracted text for the heading: ${h}. Should be "N/A" if not found.`
                    };
                }
                propertyOrdering.push(key);
            });

            const systemPrompt = "You are a data extraction expert. You will be given the raw, unstructured text content of a university course handbook page. Use the headings found within this text (e.g., 'Course Description', 'Learning Outcomes', etc.) to accurately populate the JSON schema. If information for a heading is not found, return 'N/A' for string fields and an empty array [] for array fields. Ensure that items for array fields are concise, single points.";

            const userQuery = `From the following raw text content, extract the data for the requested JSON schema.\n\nText content:\n\n${truncatedText}`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: schemaProperties,
                        propertyOrdering: propertyOrdering
                    }
                }
            };

            // Call the helper fetchWithBackoff which attaches the key
            const result = await Utils.fetchWithBackoff(payload, geminiKey);
            const candidateText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!candidateText) {
                throw new Error('Gemini returned no content.');
            }

            // Some LLM outputs may be wrapped in code fences — strip and parse
            let jsonString = candidateText.trim().replace(/^```(?:json)?\s*|```\s*$/g, '');
            try {
                const extracted = JSON.parse(jsonString);
                // Add metadata
                extracted.courseCode = courseCode || extracted.courseCode || courseId;
                extracted.url = url;
                extracted.courseTitle = extracted.courseTitle || courseTitle;
                return extracted;
            } catch (e) {
                throw new Error('Failed to parse JSON returned by Gemini: ' + e.message);
            }
        }

        /**
         * Public method to get a course outline from cache or fetch it if missing/expired.
         * Will obtain the Gemini key from KeyManager if not provided.
         */
        async function getOrFetch(courseId, courseCode = null, url = null, geminiApiKey = null) {
            const cacheKey = CONFIG.CACHE_KEY_MODULE_DATA + courseId;

            try {
                // 1. Try cache if enabled
                if (CONFIG.useOutlineCache) {
                    const cachedValue = await GM.getValue(cacheKey, null);
                    if (cachedValue) {
                        try {
                            const cachedData = JSON.parse(cachedValue);
                            const isFresh = (Date.now() - cachedData.timestamp) < CONFIG.CACHE_DURATION_MS;
                            if (isFresh) {
                                console.log(`[CourseOutline] Returning outline for ${courseId} from cache.`);
                                return cachedData.data;
                            } else {
                                console.log(`[CourseOutline] Cache expired for ${courseId}. Refetching.`);
                            }
                        } catch (e) {
                            console.warn('[CourseOutline] Invalid cache format — refetching.', e);
                        }
                    }
                }

                // 2. Ensure we have a Gemini key
                let key = geminiApiKey;
                if (!key) {
                    key = await KeyManager.getOrRequestKey(CONFIG.KEY_GEMINI, 'Gemini API Key');
                    if (!key) throw new Error('Gemini API key required to fetch course outline.');
                }

                // If courseCode is missing try utility
                if (!courseCode && courseId) {
                    courseCode = Utils.getCourseCode(courseId);
                }

                // If url missing and courseCode present, build it
                if (!url && courseCode) {
                    url = CONFIG.handbookURLtemplate.replace('{year}', CONFIG.YEAR).replace('{courseCode}', courseCode);
                }

                if (!url) {
                    throw new Error('No URL available to fetch course outline.');
                }

                // 3. Fetch fresh data
                const fetchedData = await _fetchCourseOutline(courseId, courseCode, url, key);

                // 4. Save to cache
                const cachePayload = {
                    timestamp: Date.now(),
                    data: fetchedData
                };
                try {
                    await GM.setValue(cacheKey, JSON.stringify(cachePayload));
                } catch (e) {
                    console.warn('[CourseOutline] Failed to persist cache:', e);
                }

                console.log(`[CourseOutline] Fetched and cached new outline for ${courseId}.`);
                return fetchedData;

            } catch (error) {
                console.error(`[CourseOutline] Failed to get or fetch outline for ${courseId}.`, error);
                return {
                    courseTitle: courseCode || 'Title Not Found',
                    courseSchedule: [],
                    learningOutcomes: [],
                    assessments: [],
                    error: error.message
                };
            }
        }

        return { getOrFetch };

    })();


    // --- 1. LLM Heading Generator Module (No change needed) ---

    const HeadingGenerator = (function (Utils, CourseOutline, CONFIG, KeyManager) {
        const HEADING_PROMPT = "You are a highly concise heading generator. Read the provided text and produce a headline that perfectly captures the content's essence in between 3 and 7 words. Do not include any other text, punctuation, or formatting, or introductory phrases. Capitalise ONLY proper nouns and the first letter."

        /**
         * Main function to extract content and call the API for heading generation.
         */
        async function generateHeading() {
            const geminiKey = await KeyManager.getOrRequestKey(CONFIG.KEY_GEMINI, 'Gemini API Key');

            if (!geminiKey) return; // User cancelled

            const courseId = Utils.getCourseId();
            let courseOutlineContent = null;

            if (courseId) {
                Utils.showNotification('Checking course outline cache...', 'loading');
                courseOutlineContent = await CourseOutline.getOrFetch(courseId);
            }

            const pageContent = document.body.innerText;
            const truncatedContent = pageContent.substring(0, CONFIG.MAX_CONTENT_LENGTH);

            if (truncatedContent.length === 0) {
                Utils.showNotification('Page content is empty. Cannot generate heading.', 'error');
                return;
            }

            let userQuery = `Task: Create a concise heading for the page content.\n\n`;

            if (courseOutlineContent) {
                // Ensure we have a string summary for context
                const outlineString = (typeof courseOutlineContent === 'string') ? courseOutlineContent : JSON.stringify(courseOutlineContent);
                const truncatedOutline = outlineString.substring(0, CONFIG.MAX_OUTLINE_LENGTH);
                userQuery += `Course Outline Context (${truncatedOutline.length} chars):\n\n---\n\n${truncatedOutline}\n\n`;
            }

            userQuery += `Page Content (${truncatedContent.length} chars):\n\n---\n\n${truncatedContent}`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: { parts: [{ text: HEADING_PROMPT }] },
                generationConfig: { temperature: 0.1 }
            };

            Utils.showNotification('Sending page content and context to LLM...', 'loading');

            try {
                const result = await Utils.fetchWithBackoff(payload, geminiKey); // Pass key to fetcher
                const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (generatedText) {
                    const cleanedHeading = generatedText.replace(/['".,!?:;]/g, '').trim();
                    Utils.showNotification(cleanedHeading, 'success', 'Generated Heading:');
                } else {
                    Utils.showNotification('LLM response was empty or malformed.', 'error');
                }
            } catch (error) {
                console.error('LLM Heading Generator Error:', error);
                Utils.showNotification(`Failed to generate heading: ${error.message}`, 'error');
            }
        }

        return {
            init: generateHeading
        };
    })(Utils, CourseOutline, CONFIG, KeyManager);


    // --- 2. Structured Data Extractor Module (No change needed) ---

    const OutlineExtractor = (function (Utils, CourseOutline, CONFIG, KeyManager) {
        // --- JSON Schema for Structured Data Extraction (unchanged) ---
        const SCHEMA = {
            type: "OBJECT",
            properties: {
                courseTitle: { type: "STRING", description: "The official full title of the course, e.g., 'Introduction to Computer Science'." },
                courseSchedule: {
                    type: "ARRAY",
                    description: "A chronological list of weekly topics, structure, or activities.",
                    items: {
                        type: "OBJECT",
                        properties: {
                            week: { type: "STRING" },
                            topic: { type: "STRING" },
                            readings: { type: "STRING", description: "Any required readings or resources for the week." }
                        },
                        required: ["week", "topic"]
                    }
                },
                learningOutcomes: {
                    type: "ARRAY",
                    description: "The official learning outcomes or objectives for the entire course.",
                    items: { type: "STRING" }
                },
                assessments: {
                    type: "ARRAY",
                    description: "All major assessment tasks and their details (e.g., name, weight, due date).",
                    items: {
                        type: "OBJECT",
                        properties: {
                            name: { type: "STRING" },
                            weight: { type: "STRING" },
                            dueDate: { type: "STRING" }
                        },
                        required: ["name"]
                    }
                }
            },
            required: ["courseTitle", "courseSchedule", "learningOutcomes", "assessments"]
        };

        /**
         * Sends the course outline text to Gemini to get a structured JSON object.
         */
        async function extractStructuredData() {
            const geminiKey = await KeyManager.getOrRequestKey(CONFIG.KEY_GEMINI, 'Gemini API Key');

            if (!geminiKey) return; // User cancelled

            const courseId = Utils.getCourseId();

            if (!courseId) {
                Utils.showNotification('Not in a course page. Cannot extract outline.', 'error');
                return;
            }

            Utils.showNotification(`Fetching outline for JSON extraction... ${courseId}`, 'loading');

            const courseOutlineContent = await CourseOutline.getOrFetch(courseId);

            if (!courseOutlineContent) {
                Utils.showNotification('Failed to get course outline content. See console for errors.', 'error');
                return;
            }

            const userQuery = `Extract the following structured information from the provided course outline text:\n\n---\n\n${(typeof courseOutlineContent === 'string') ? courseOutlineContent.substring(0, CONFIG.MAX_OUTLINE_LENGTH) : JSON.stringify(courseOutlineContent).substring(0, CONFIG.MAX_OUTLINE_LENGTH)}`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: {
                    parts: [{ text: "You are a professional academic data extractor. Your sole task is to analyze the provided course outline and return a comprehensive JSON object that strictly adheres to the provided schema. Do not include any text, conversational remarks, or markdown code blocks outside of the JSON structure itself." }]
                },
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: SCHEMA
                }
            };

            try {
                const result = await Utils.fetchWithBackoff(payload, geminiKey); // Pass key to fetcher
                const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (jsonText) {
                    const cleanedJsonText = jsonText.replace(/^```json\s*|```\s*$/g, '');
                    const structuredData = JSON.parse(cleanedJsonText);
                    console.log(`--- Gemini Structured Data for Course ID ${courseId} ---`);
                    console.log(structuredData);
                    console.log('----------------------------------------------------');
                    Utils.showNotification('Structured data extracted and logged to console.', 'success', 'Course Outline JSON Extracted');
                } else {
                    Utils.showNotification('LLM response was empty or malformed (JSON).', 'error');
                }
            } catch (error) {
                console.error('LLM Structured Data Extractor Error:', error);
                Utils.showNotification(`Failed to extract structured data: ${error.message}`, 'error');
            }
        }

        return {
            init: extractStructuredData
        };
    })(Utils, CourseOutline, CONFIG, KeyManager);


    // ----------------------------------------------------------------------
    // --- 3. Module Data Fetcher Module (UPDATED) ---
    // ----------------------------------------------------------------------

    const ModuleDataFetcher = (function (Utils, CONFIG, KeyManager) {
        // --- JSON Schema for Structured Data Extraction ---
        const SCHEMA = {
            type: "OBJECT",
            properties: {
                moduleName: { type: "STRING", description: "The official name of the module." },
                introduction: { type: "STRING", description: "A welcoming, friendly, and engaging introductory paragraph (2-3 sentences) to this module for the student." },
                keyTakeaways: {
                    type: "STRING",
                    description: "3 to 5 concise, engaging bullet points, formatted using a markdown list (*), that summarize the most critical learning points, fast facts, or concepts from the module content.",
                },
                comingUpNext: { type: "STRING", description: "A friendly, short blurb (1-2 sentences) that lets a student who just finished this module know what they can expect in the NEXT module." },
                fullSummary: { type: "STRING", description: "A detailed, comprehensive summary of all the module content, suitable for revision and formatted into clear paragraphs." }
            },
            required: ["moduleName", "introduction", "keyTakeaways", "comingUpNext", "fullSummary"]
        };

        const LLM_SYSTEM_PROMPT = "You are an expert academic assistant that structures educational data. Your task is to analyze the provided module content and generate a single JSON object that strictly adheres to the provided schema. Do not include any text, conversational remarks, or markdown code blocks outside of the JSON structure itself. Ensure the 'keyTakeaways' and 'comingUpNext' fields are friendly and student-focused.";


        /**
         * Fetches the list of modules for the current course.
         */
        function fetchCanvasModules(courseId, canvasKey) {
            const baseUrl = Utils.getCanvasBaseUrl();
            if (!baseUrl) {
                throw new Error("Could not determine Canvas base URL.");
            }

            const url = `${baseUrl}/api/v1/courses/${courseId}/modules?per_page=100&include[]=items`;

            return new Promise((resolve, reject) => {
                GM.xmlhttpRequest({
                    method: "GET",
                    url: url,
                    headers: { "Authorization": `Bearer ${canvasKey}` },
                    onload: function (response) {
                        if (response.status === 200) {
                            resolve(JSON.parse(response.responseText));
                        } else {
                            reject(new Error(`Failed to fetch modules. Status: ${response.status} - ${response.responseText}`));
                        }
                    },
                    onerror: function (error) {
                        reject(new Error(`Network error fetching modules: ${error.responseText || error.statusText}`));
                    }
                });
            });
        }

        /**
         * Fetches the content of a single module item (if it's a Page).
         */
        function fetchModulePageContent(courseId, moduleItem, canvasKey) {
            if (moduleItem.type !== 'Page') {
                return Promise.resolve(`[Skipping Non-Page Item: ${moduleItem.title} (${moduleItem.type})]`);
            }

            const baseUrl = Utils.getCanvasBaseUrl();
            const pageUrl = `${baseUrl}/api/v1/courses/${courseId}/pages/${moduleItem.page_url}`;

            return new Promise((resolve) => {
                GM.xmlhttpRequest({
                    method: "GET",
                    url: pageUrl,
                    headers: { "Authorization": `Bearer ${canvasKey}` },
                    onload: function (response) {
                        if (response.status === 200) {
                            try {
                                const pageData = JSON.parse(response.responseText);
                                const htmlContent = pageData.body;

                                const parser = new DOMParser();
                                const doc = parser.parseFromString(htmlContent, "text/html");
                                let plainText = doc.body.innerText;

                                plainText = plainText.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

                                // Truncate content to avoid overwhelming the LLM
                                const truncatedContent = plainText.substring(0, CONFIG.MAX_CONTENT_LENGTH);
                                resolve(`--- PAGE START: ${moduleItem.title} ---\n${truncatedContent}\n--- PAGE END ---\n\n`);

                            } catch (e) {
                                console.error(`Failed to parse module page content for ${moduleItem.title}:`, e);
                                resolve(`[ERROR: Could not parse content for page: ${moduleItem.title}]`);
                            }
                        } else {
                            console.warn(`Failed to fetch page '${moduleItem.title}'. Status: ${response.status}`);
                            resolve(`[ERROR: Could not fetch content for page: ${moduleItem.title}. Status ${response.status}]`);
                        }
                    },
                    onerror: function (error) {
                        console.error(`Network error fetching page '${moduleItem.title}':`, error);
                        resolve(`[ERROR: Network error fetching page: ${moduleItem.title}]`);
                    }
                });
            });
        }

        /**
         * Orchestrates the fetching, collating, and LLM structuring of a module's content.
         */
        async function getOrFetchModuleData(courseId, moduleData, geminiKey, canvasKey) {
            const cacheKey = CONFIG.CACHE_KEY_MODULE_DATA + moduleData.id;
            const moduleName = moduleData.name;
            const maxTotalLength = CONFIG.MAX_CONTENT_LENGTH * 10; // Allow a larger total context

            // 1. Check Cache
            const cachedJson = await GM.getValue(cacheKey, null);
            if (cachedJson) {
                try {
                    const cachedData = JSON.parse(cachedJson);
                    console.log(`[ModuleDataFetcher] Using cached data for module: ${moduleName}`);
                    Utils.showNotification(`Data for **${moduleName}** loaded from local cache. Select a data point to copy.`, 'success', 'Cache Loaded');
                    return cachedData;
                } catch (e) {
                    console.warn(`[ModuleDataFetcher] Failed to parse cached JSON for module ${moduleName}. Re-fetching.`, e);
                }
            }

            // 2. Cache Miss: Start Fetching
            Utils.showNotification(`Fetching all pages in module: **${moduleName}**... (This may take a moment)`, 'loading');

            try {
                // Fetch content for all items in parallel
                const itemPromises = moduleData.items.map(item => fetchModulePageContent(courseId, item, canvasKey));
                const allContent = await Promise.all(itemPromises);

                // Collate all text and truncate
                const collatedText = allContent.join('\n\n');

                if (collatedText.trim().length < 50) {
                    Utils.showNotification(`Module **${moduleName}** has no readable content pages to summarize.`, 'error');
                    return null;
                }

                const finalCollatedText = collatedText.substring(0, maxTotalLength);

                // 3. Prepare payload for Gemini API
                const userQuery = `Task: Analyze the module content titled "${moduleName}" and generate structured data. The content is ${finalCollatedText.length} characters long.\n\n---\n\n${finalCollatedText}`;

                const payload = {
                    contents: [{ parts: [{ text: userQuery }] }],
                    systemInstruction: { parts: [{ text: LLM_SYSTEM_PROMPT }] },
                    generationConfig: {
                        temperature: 0.2,
                        responseMimeType: "application/json",
                        responseSchema: SCHEMA
                    }
                };

                Utils.showNotification(`Analyzing content and structuring data for **${moduleName}** with LLM...`, 'loading');

                // 4. Call Gemini API
                const result = await Utils.fetchWithBackoff(payload, geminiKey);
                const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

                if (jsonText) {
                    const cleanedJsonText = jsonText.replace(/^```json\s*|```\s*$/g, '');
                    const structuredData = JSON.parse(cleanedJsonText);

                    // 5. Cache the result
                    await GM.setValue(cacheKey, cleanedJsonText);
                    console.log(`[ModuleDataFetcher] Data for ${moduleName} fetched and cached successfully.`);

                    Utils.showNotification(`Structured data for **${moduleName}** successfully generated and cached. Select a data point to copy.`, 'success', 'Data Fetched');
                    return structuredData;
                } else {
                    Utils.showNotification('LLM response was empty or malformed (JSON).', 'error');
                    return null;
                }

            } catch (error) {
                console.error('Module Data Fetcher Error:', error);
                Utils.showNotification(`Module data fetching failed: ${error.message}`, 'error');
                return null;
            }
        }

        return {
            fetchCanvasModules,
            fetchModulePageContent,
            getOrFetchModuleData
        };
    })(Utils, CONFIG, KeyManager);


    // ----------------------------------------------------------------------
    // --- 4. Course Page Lister Module (UPDATED TO USE COMMON CANVAS KEY) ---
    // ----------------------------------------------------------------------

    const PageLister = (function (Utils, KeyManager) {
        // --- Local Configuration (Module Scope) ---
        const CANVAS_DOMAIN = 'https://canvas.newcastle.edu.au';
        const MAX_PAGES_TO_LOAD = 10000;
        const CURRENT_COURSE_ID = Utils.getCourseId();

        let OVERLAY_ELEMENT = null;
        let API_ENDPOINT = null;

        if (CURRENT_COURSE_ID) {
            API_ENDPOINT = `${CANVAS_DOMAIN}/api/v1/courses/${CURRENT_COURSE_ID}/pages?per_page=${MAX_PAGES_TO_LOAD}&published=true`;
        } else {
            return { init: () => Utils.showNotification('Cannot use Page Lister outside of a Canvas Course.', 'error') };
        }

        // --- Core UI Functions ---

        /** Clones styles from the host document head into the overlay. */
        function cloneHostStyles(overlay) {
            const styleWrapper = document.createElement('div');
            styleWrapper.id = 'style-wrapper';
            overlay.prepend(styleWrapper);
            document.querySelectorAll('head link[rel="stylesheet"]').forEach(link => { const clone = link.cloneNode(true); styleWrapper.appendChild(clone); });
            document.querySelectorAll('head style').forEach(style => { const clone = style.cloneNode(true); styleWrapper.appendChild(clone); });
        }

        /** Filters the rendered list of pages based on the input text. */
        function filterPages(event) {
            const filterText = event.target.value.toLowerCase();
            document.querySelectorAll('#pages-list li').forEach(li => {
                const title = li.dataset.title;
                li.style.display = (title && title.includes(filterText)) ? 'block' : 'none';
            });
        }

        /** Renders the fetched pages into the overlay list. */
        function renderPages(pages) {
            const list = document.getElementById('pages-list');
            list.innerHTML = '';
            if (pages.length === 0) {
                list.innerHTML = '<li>No published pages found.</li>';
                return;
            }
            pages.forEach(page => {
                const pageUrl = `${CANVAS_DOMAIN}/courses/${CURRENT_COURSE_ID}/pages/${page.url}`;
                const listItem = document.createElement('li');
                listItem.setAttribute('data-title', page.title.toLowerCase());
                listItem.innerHTML = `<a href="${pageUrl}" title="Open page in new tab" target="_blank">${page.title}</a>`;
                list.appendChild(listItem);
            });
            const header = document.querySelector('#pages-overlay h3');
            header.textContent = `📜 Course Pages (${pages.length} loaded)`;
        }

        /** Fetches the pages from the Canvas API and passes them to the renderer. */
        async function fetchAndRenderPages(token) {
            const pagesList = document.getElementById('pages-list');
            const warningContainer = document.getElementById('warning-container');
            warningContainer.innerHTML = '';

            pagesList.innerHTML = '<li><small>Fetching published pages...</small></li>';

            try {
                const response = await fetch(API_ENDPOINT, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    let errorMessage = response.statusText;
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.errors ? errorData.errors[0].message : errorMessage;
                    } catch (e) { }
                    throw new Error(`API Error ${response.status}: ${errorMessage}.`);
                }

                const pages = await response.json();
                renderPages(pages);

                if (pages.length >= MAX_PAGES_TO_LOAD) {
                    const warningMessage = document.createElement('div');
                    warningMessage.id = 'warning-message';
                    warningMessage.innerHTML = `**Warning:** Displaying ${pages.length} pages. There may be more!`;
                    warningContainer.appendChild(warningMessage);
                }

            } catch (error) {
                pagesList.innerHTML = `<li><small style="color: red;">Error loading pages: ${error.message}. Use **Settings** (⚙️) to clear/re-enter token.</small></li>`;
                console.error('Canvas API Fetch Error:', error);
            }
        }


        /** Creates and injects the overlay HTML/CSS and attaches event listeners. */
        async function createOverlay() {
            if (OVERLAY_ELEMENT) return;

            // --- Base Styles (unchanged) ---
            const baseStyle = document.createElement('style');
            baseStyle.textContent = `
                    #pages-overlay { position: fixed; top: 10px; right: 10px; z-index: 10000; width: 320px; max-height: 95%; background: #fff; border: 1px solid #ccc; box-shadow: 0 6px 15px rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow: hidden; display: none; font-family: inherit; }
                    #overlay-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
                    #page-filter, #token-display { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
                    #pages-list { list-style: none; margin: 0; padding: 0; max-height: 75vh; overflow-y: auto; }
                    #pages-list li a { text-decoration: none; display: block; padding: 5px 0; border-bottom: 1px solid #eee; }
                    #toggle-overlay { background: none; border: none; font-size: 24px; cursor: pointer; line-height: 1; color: #555; }
                    #settings-view { display: none; }
                    #settings-view button { padding: 8px 15px; border-radius: 4px; cursor: pointer; }
                    #clear-token-btn { background: #dc3545; color: white; border: none; }
                    #warning-message { padding: 10px; background-color: #fce3e3; color: #cc0000; border: 1px solid #cc0000; border-radius: 4px; margin-bottom: 10px; }
                `;
            document.head.appendChild(baseStyle);

            // --- HTML structure ---
            const overlayHTML = `
                    <div id="pages-overlay">
                        <div id="overlay-header">
                            <h3 style="margin: 0;">📜 Course Pages (ID: ${CURRENT_COURSE_ID})</h3>
                            <div>
                                <button id="settings-btn" class="Button--icon-action" title="Settings (Token Management)" style="margin-right: 5px;">⚙️</button>
                                <button id="toggle-overlay" title="Close (ESC)">✖</button>
                            </div>
                        </div>

                        <div id="main-view">
                            <div id="warning-container"></div>
                            <input type="text" id="page-filter" placeholder="Filter pages by title..." accesskey="f">
                            <ul id="pages-list">
                                <li><small>Click the 'Course Page Lister' button to load...</small></li>
                            </ul>
                        </div>

                        <div id="settings-view">
                            <h4>API Access Token Settings</h4>
                            <p>This token is used by all Canvas requests.</p>
                            <p id="token-display">Status: Loading...</p>
                            <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                                <button id="enter-token-btn" style="background: #008000; color: white; border: none;">Enter/Re-enter Token</button>
                                <button id="clear-token-btn">Clear Saved Token</button>
                            </div>
                        </div>
                    </div>
                `;

            document.body.insertAdjacentHTML('beforeend', overlayHTML);
            OVERLAY_ELEMENT = document.getElementById('pages-overlay');
            cloneHostStyles(OVERLAY_ELEMENT);
            attachEventListeners();
        }

        /** Attaches all UI event handlers */
        function attachEventListeners() {
            const handleKeydown = (e) => {
                if (OVERLAY_ELEMENT.style.display === 'block' && e.key === 'Escape') {
                    OVERLAY_ELEMENT.style.display = 'none';
                }
            };
            document.addEventListener('keydown', handleKeydown);

            document.getElementById('toggle-overlay').addEventListener('click', () => OVERLAY_ELEMENT.style.display = 'none');
            document.getElementById('page-filter').addEventListener('input', filterPages);

            // Settings buttons
            document.getElementById('settings-btn').addEventListener('click', async () => {
                const token = await GM.getValue(CONFIG.KEY_CANVAS, null);
                document.getElementById('token-display').textContent = token ? 'Status: Key is SAVED (**********)' : 'Status: Key is MISSING';
                showView('settings');
                document.getElementById('enter-token-btn').focus();
            });

            document.getElementById('enter-token-btn').addEventListener('click', async () => {
                // Trigger the global KeyManager modal
                const newToken = await KeyManager.getOrRequestKey(CONFIG.KEY_CANVAS, 'Canvas API Key', 'https://canvas.instructure.com/doc/api/tokens.html');
                if (newToken) {
                    showView('main');
                    await fetchAndRenderPages(newToken);
                    document.getElementById('page-filter').focus();
                } else {
                    document.getElementById('token-display').textContent = 'Status: Key is MISSING';
                }
            });

            document.getElementById('clear-token-btn').addEventListener('click', async () => {
                await KeyManager.clearKey(CONFIG.KEY_CANVAS, 'Canvas API Key');
                document.getElementById('token-display').textContent = 'Status: Key is MISSING';
                document.getElementById('pages-list').innerHTML = '<li><small>Token is missing. Go to Settings (⚙️).</small></li>';
                document.getElementById('enter-token-btn').focus();
            });
        }

        /** Switches between the main pages view and the settings view. */
        function showView(view) {
            const mainView = document.getElementById('main-view');
            const settingsView = document.getElementById('settings-view');
            if (view === 'settings') {
                mainView.style.display = 'none';
                settingsView.style.display = 'block';
            } else {
                mainView.style.display = 'block';
                settingsView.style.display = 'none';
            }
        }


        /** The primary public entry point (The button handler) */
        async function init() {
            if (!OVERLAY_ELEMENT) { await createOverlay(); }

            // Toggle visibility
            if (OVERLAY_ELEMENT.style.display === 'block') {
                OVERLAY_ELEMENT.style.display = 'none';
                return;
            }
            OVERLAY_ELEMENT.style.display = 'block';

            // Initial view check
            const token = await GM.getValue(CONFIG.KEY_CANVAS, null);

            if (!token) {
                // If token is missing, request it via the central manager
                const newToken = await KeyManager.getOrRequestKey(CONFIG.KEY_CANVAS, 'Canvas API Key', 'https://canvas.instructure.com/doc/api/tokens.html');
                if (newToken) {
                    showView('main');
                    await fetchAndRenderPages(newToken);
                    document.getElementById('page-filter').focus();
                } else {
                    // If cancelled, show settings view
                    document.getElementById('token-display').textContent = 'Status: Key is MISSING';
                    showView('settings');
                    document.getElementById('enter-token-btn').focus();
                }
            } else {
                // If token exists, just load pages
                showView('main');
                await fetchAndRenderPages(token);
                document.getElementById('page-filter').focus();
            }
        }

        return { init };
    })(Utils, KeyManager);


    // --- Plugin/Feature Registry ---

    const userScripts = {
        'heading-generator': {
            label: 'Generate LLM Heading',
            backgroundColor: '#007bff',
            hoverColor: '#0056b3',
            handler: HeadingGenerator.init
        },
        'outline-extractor': {
            label: 'Extract Outline Data',
            backgroundColor: '#38bdf8',
            hoverColor: '#0284c7',
            handler: OutlineExtractor.init
        },
        'module-data-fetcher': {
            label: 'Fetch Module Data',
            backgroundColor: '#FF6F00',
            hoverColor: '#E65100',
            handler: ModuleDataFetcher.init
        },
        'page-lister': {
            label: 'Course Page Lister',
            backgroundColor: '#8B5CF6',
            hoverColor: '#6D28D9',
            handler: PageLister.init
        }
    };


    // --- Main Execution Logic ---

    function createActionButton() {
        if (!Utils.getCourseId()) return;

        const actionContainer = document.createElement('div');
        actionContainer.id = 'llm-action-container';
        Object.assign(actionContainer.style, {
            position: 'fixed',
            bottom: '20px',
            right: '35%',
            zIndex: '9999',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            fontFamily: 'system-ui, sans-serif',
            flexDirection: 'column-reverse'
        });

        const primaryContainer = document.createElement('div');
        Object.assign(primaryContainer.style, { display: 'flex', gap: '10px' });
        let specialButtons = [];

        for (const key in userScripts) {
            const script = userScripts[key];
            const button = document.createElement('button');
            button.textContent = script.label;
            Object.assign(button.style, {
                padding: '10px 15px',
                backgroundColor: script.backgroundColor,
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '14px',
                transition: 'background-color 0.3s',
                flexShrink: '0'
            });

            button.addEventListener('click', script.handler);
            button.addEventListener('mouseover', () => { button.style.backgroundColor = script.hoverColor; });
            button.addEventListener('mouseout', () => { button.style.backgroundColor = script.backgroundColor; });

            if (key === 'module-data-fetcher' || key === 'page-lister') {
                specialButtons.push(button);
            } else {
                primaryContainer.appendChild(button);
            }
        }

        if (primaryContainer.children.length > 0) {
            actionContainer.appendChild(primaryContainer);
        }

        if (specialButtons.length > 0) {
            const secondaryContainer = document.createElement('div');
            Object.assign(secondaryContainer.style, { display: 'flex', gap: '10px' });
            specialButtons.forEach(btn => secondaryContainer.appendChild(btn));
            actionContainer.prepend(secondaryContainer);
        }

        // === Add Settings Button ===
        const settingsBtn = document.createElement('button');
        settingsBtn.textContent = 'Settings ⚙️';
        Object.assign(settingsBtn.style, {
            padding: '8px 12px',
            backgroundColor: '#444',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
            fontSize: '13px'
        });
        settingsBtn.addEventListener('click', () => {
            KeyManager.openSettings();
        });

        actionContainer.appendChild(settingsBtn);

        document.body.appendChild(actionContainer);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        createActionButton();
    } else {
        window.addEventListener('load', createActionButton);
    }

}
