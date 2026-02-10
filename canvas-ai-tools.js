(function () {
    'use strict';
    if (window !== window.parent) return;

    // --- Configuration ---
    const apiKey = "AIzaSyDZIRqIVsjUZE9nVrjpNCC0ZQcDfFfcREU";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const MAX_CONTENT_LENGTH = 10000; // Truncate page content to avoid massive API requests
    const MAX_OUTLINE_LENGTH = 5000; // Max chars of outline to send to LLM for context
    const MAX_RETRIES = 5;
    const PROMPT = "You are a highly concise heading generator. Read the provided text and produce a headline that perfectly captures the content's essence in between 3 and 7 words. Do not include any other text, punctuation, or formatting, or introductory phrases. Capitalise ONLY proper nouns and the first letter."

    // Course Outline Caching Constants
    const COURSE_OUTLINE_URL_TEMPLATE = "https://canvas.newcastle.edu.au/courses/{course_id}/pages/course-outline";
    const COURSE_HANDBOOK_URL_TEMPLATE = "https://handbook.newcastle.edu.au/course/2026/{course_code}"
    const CACHE_KEY_CONTENT = 'llm_heading_course_outline_content_';
    const CACHE_KEY_TIMESTAMP = 'llm_heading_course_outline_timestamp_';
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    const USE_CACHE = false; // Set to false to disable caching and always fetch fresh data

    // --- JSON Schema for Structured Data Extraction ---
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

    // --- Utility Functions ---

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
     * Executes an API call with exponential backoff for resilience.
     * @param {object} payload - The request body.
     * @returns {Promise<object>} The JSON response from the API.
     */
    async function fetchWithBackoff(payload) {
        let delay = 1000; // 1 second starting delay
        let lastError = null;

        for (let i = 0; i < MAX_RETRIES; i++) {
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
                if (i < MAX_RETRIES - 1) {
                    await sleep(delay);
                    delay *= 2;
                }
            }
        }
        // If loop finishes without success
        throw new Error(`Failed to fetch after ${MAX_RETRIES} attempts. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
    }

    /**
     * Copies text to the clipboard using the execCommand method.
     * @param {string} text - The text to copy.
     */
    function copyToClipboard(text) {
        const tempInput = document.createElement('textarea');
        tempInput.value = text;
        tempInput.style.position = 'absolute';
        tempInput.style.left = '-9999px'; // Hide off-screen
        document.body.appendChild(tempInput);
        tempInput.select();
        try {
            const success = document.execCommand('copy');
            return success;
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
     */
    function showNotification(content, type) {
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
                cursor: 'pointer'
            });
            document.body.appendChild(notification);
            notification.onclick = () => notification.remove();
        }

        let backgroundColor, textColor;
        switch (type) {
            case 'loading':
                backgroundColor = '#4a90e2';
                textColor = 'white';
                break;
            case 'success':
                backgroundColor = '#4CAF50';
                textColor = 'white';
                break;
            case 'error':
                backgroundColor = '#F44336';
                textColor = 'white';
                break;
            default:
                backgroundColor = '#333';
                textColor = 'white';
        }

        Object.assign(notification.style, {
            backgroundColor: backgroundColor,
            color: textColor,
            border: type === 'loading' ? '2px solid #fff' : 'none',
        });

        let innerContent = '';

        if (type === 'success') {
            const copyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

            innerContent = `
                <strong>SUCCESS:</strong> Generated Heading: <br/>
                <span style="display: inline-flex; align-items: center; gap: 8px;">
                    <strong id="llm-heading-text">${content}</strong>
                    <span id="llm-copy-button" title="Copy to clipboard" style="cursor: pointer; display: flex; align-items: center; padding: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.1);">
                        ${copyIconSvg}
                    </span>
                </span>
            `;
        } else {
            innerContent = `<strong>${type.toUpperCase()}:</strong> ${content}`;
        }

        notification.innerHTML = innerContent;

        // Attach copy listener only if it's a success message
        if (type === 'success') {
            const copyButton = document.getElementById('llm-copy-button');
            if (copyButton) {
                // Prevent the notification's self-removal when clicking the copy button
                copyButton.onclick = (e) => {
                    e.stopPropagation();
                    const textToCopy = content;
                    const success = copyToClipboard(textToCopy);

                    if (success) {
                        // Show temporary 'Copied!' feedback
                        const originalContent = copyButton.innerHTML;
                        copyButton.innerHTML = `<span style="color: #ffeb3b; font-size: 12px; font-weight: bold;">COPIED!</span>`;
                        setTimeout(() => { copyButton.innerHTML = originalContent; }, 1500);
                    } else {
                        showNotification('Copy failed. Try manually.', 'error');
                    }
                };
            }
        }

        // Auto-hide success/error messages after 5 seconds
        if (type !== 'loading') {
            setTimeout(() => {
                Object.assign(notification.style, {
                    opacity: '0',
                    transform: 'translateY(-20px)'
                });
                setTimeout(() => notification.remove(), 500);
            }, 5000);
        }
    }

    /**
     * Extracts the course ID from the current URL.
     * @returns {string | null} The course ID or null if not found.
     */
    function getCourseId() {
        const url = window.location.href;
        // Matches /courses/{NUMBER} or /courses/{NUMBER}/...
        const match = url.match(/\/courses\/(\d+)/);
        return match ? match[1] : null;
    }

    function getCourseCode(course_id) {
        const element = document.querySelector(`#breadcrumbs a[href*='courses/${course_id}']`)
        const code = element.textContent.split(' ')[0]
        alert(code)
        return code
    }

    /**
     * Fetches the Course Outline page content using GM_xmlhttpRequest.
     * @param {string} courseId - The ID of the course.
     * @returns {Promise<string>} The extracted text content of the outline.
     */
    function fetchCourseOutline(courseId) {
        // const url = COURSE_OUTLINE_URL_TEMPLATE.replace('{course_id}', courseId);
        const courseCode = getCourseCode(courseId)
        const hb_url = COURSE_HANDBOOK_URL_TEMPLATE.replace('{course_code}', courseCode);
        console.log("Fetching course outline from URL:", hb_url)
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === 'undefined') {
                reject(new Error("GM_xmlhttpRequest is not defined. Ensure you are running this in a compatible userscript environment."));
                return;
            }

            GM_xmlhttpRequest({
                method: "GET",
                url: hb_url,
                onload: function (response) {
                    if (response.status === 200) {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(response.responseText, "text/html");
                            console.log("Successfully fetched course outline page. Parsing content...");
                            //    console.dir(JSON.parse(response.responseText))
                            //    const url = COURSE_OUTLINE_URL_TEMPLATE.replace('{course_id}', courseId);
                            // Temporary structure to hold extracted data
                            const extractedData = {
                                courseCode: courseCode,
                                description: '',
                                url: hb_url,
                                title: 'Title Not Found',
                                keyDetails: {},
                                contentSections: {},
                                links: {}
                            };

                            // 1. Find all script tags
                            const scripts = doc.querySelectorAll('script');

                            console.dir(scripts)


                            // 2. Find the script that contains our target variable
                            let envConfigData = null;
                            let bootstrapConfigData = null;

                            scripts.forEach(script => {
                                const content = script.textContent;
                                console.log(content)
                              //  debugger;
                                if (content.includes('window.__SITE_ENV_CONFIG__') || content.includes('window.__SITE_BOOTSTRAP_CONFIG__ ') || content.includes('"props:"')) {

                                    // 3. Use Regex to capture everything between the first '=' and the first ';'
                                    const regex = /window\.__SITE_ENV_CONFIG__\s*=\s*({.*?});/;
                                    const regexBootstrap = /window\.__SITE_BOOTSTRAP_CONFIG__\s*=\s*({.*?});/;
                                    const propsRegex = /"props"\s*:\s*({.*?})/;
                                    const envMatch = content.match(regex)
                                    const bootStrapMatch = content.match(regexBootstrap);
                                    const propsMatch = content.match(propsRegex)
                                   
                                 //   debugger;
                                    if (envMatch && envMatch[1]) {
                                        try {
                                            envConfigData = JSON.parse(envMatch[1]);
                                        } catch (e) {
                                            console.error("Failed to parse JSON", e);
                                        }
                                    }
                                    if (bootStrapMatch && bootStrapMatch[1]) {
                                        try {
                                            bootstrapConfigData = JSON.parse(bootStrapMatch[1]);
                                        } catch (e) {
                                            console.error("Failed to parse JSON", e);
                                        }
                                    }
                                    if (propsMatch && propsMatch[1]) {
                                        try {
                                            bootstrapConfigData = JSON.parse(propsMatch[1]);
                                        } catch (e) {
                                            console.error("Failed to parse JSON", e);
                                        }
                                    }
                                }
                            });

                            console.log("Extracted __SITE_ENV_CONFIG__:")
                            console.dir(envConfigData);
                            console.log("Extracted __SITE_BOOTSTRAP_CONFIG__:");
                            console.dir(bootstrapConfigData);
                            console.log("Extracted props:");
                            console.dir(propsMatch)
                            debugger;
                            // 1. Course Title Selector: Targets the main H1 title.
                            const titleElement = doc.querySelector('#academic-item-banner h1.course-title');
                            extractedData.title = titleElement ? titleElement.innerText.trim() : 'Title Not Found';
                            const courseDescriptionElement = doc.getElementById('Coursedescription')
                            extractedData.description = courseDescriptionElement ? courseDescriptionElement.textContent.trim() : 'Description Not Found';
                            // 2. Extract all key details and content sections
                            // This logic targets elements that follow the H3/H4 headings in detail blocks.
                            const detailSections = doc.querySelectorAll('div.course-details > div.detail-section');

                            detailSections.forEach(section => {
                                const heading = section.querySelector('h3, h4');
                                if (heading) {
                                    let key = heading.innerText.trim();

                                    // Normalize key text for object property names
                                    key = key.toLowerCase().replace(/\s+/g, '').replace(/requisites|prerequisites/i, 'prerequisites');

                                    // Get the content following the heading
                                    let content = '';
                                    // Select common content containers within the section
                                    const contentElements = Array.from(section.querySelectorAll('p, ul, li'));

                                    // Join all visible content in the section
                                    content = contentElements.map(el => el.innerText.trim()).filter(text => text).join('\n');

                                    // Check if it's metadata (simple value) or a long-form content block
                                    if (key.includes('units') || key.includes('level') || key.includes('college') || key.includes('school') || key.includes('studylevel')) {
                                        extractedData.keyDetails[key] = content;
                                    } else {
                                        extractedData.contentSections[key] = content || 'Content Not Found';
                                    }
                                }
                            });

                            // 3. Extract specific links (Timetable and Course Outline)
                            const linkElements = doc.querySelectorAll('a[href*="timetable"], a[href*="course-outline"]');

                            linkElements.forEach(link => {
                                const text = link.innerText.trim();
                                const href = link.getAttribute('href');

                                if (text.toLowerCase().includes('timetable')) {
                                    extractedData.links.timetable = href;
                                } else if (text.toLowerCase().includes('outline')) {
                                    extractedData.links.courseOutline = href;
                                }
                            });


                            // 4. Flatten and standardize the output structure to meet the user's explicit request
                            const structuralData = {
                                courseCode: extractedData.courseCode,
                                url: extractedData.url,
                                title: extractedData.title,
                            };

                            // Map Metadata (keyDetails)
                            structuralData.units = extractedData.keyDetails['units'] || 'N/A';
                            structuralData.unitLevel = extractedData.keyDetails['courselevel'] || 'N/A'; // Renamed from courselevel
                            structuralData.studyLevel = extractedData.keyDetails['studylevel'] || 'N/A';
                            structuralData.college = extractedData.keyDetails['college'] || 'N/A';
                            structuralData.school = extractedData.keyDetails['school'] || 'N/A';

                            // Map Content Sections (contentSections) and rename keys
                            structuralData.schedule = extractedData.contentSections['availability'] || 'N/A'; // Renamed from availability
                            structuralData.learningOutcomes = extractedData.contentSections['learningoutcomes'] || 'N/A'; // Renamed from learningoutcomes
                            structuralData.assessments = extractedData.contentSections['assessments'] || 'N/A';

                            // Include other content sections for completeness
                            structuralData.prerequisites = extractedData.contentSections['prerequisites'] || 'N/A';
                            structuralData.description = extractedData.contentSections['coursedescription'] || 'N/A';
                            structuralData.content = extractedData.contentSections['coursecontent'] || 'N/A';
                            structuralData.contactHours = extractedData.contentSections['contacthours'] || 'N/A';
                            structuralData.links = extractedData.links;

                            resolve(structuralData);

                        } catch (e) {
                            reject(new Error(`Failed to parse response HTML: ${e.message}`));
                        }
                    } else {
                        reject(new Error(`Failed to fetch course outline. Status: ${response.status}`));
                    }
                },
                onerror: function (error) {
                    reject(new Error(`Network error fetching course outline: ${error.responseText || error.statusText}`));
                }
            });
        });
    }

    /**
     * Retrieves the course outline from cache or fetches it if stale/missing.
     * Updates cache if a new fetch is successful.
     * @param {string} courseId - The ID of the course.
     * @returns {Promise<string | null>} The course outline content or null.
     */
    async function getOrFetchCourseOutline(courseId) {
        const contentKey = CACHE_KEY_CONTENT + courseId;
        const timestampKey = CACHE_KEY_TIMESTAMP + courseId;
        const now = Date.now();

        if (USE_CACHE) {
            const cachedContent = await GM.getValue(contentKey, null);
            const cachedTimestamp = await GM.getValue(timestampKey, 0);


            if (cachedContent && (now - cachedTimestamp) < ONE_DAY_MS) {
                console.log(`[LLM Heading] Using cached course outline for ${courseId}.`);
                console.dir(cachedContent)
                return cachedContent;
            }
        }

        // Cache is stale or missing, fetch new data
        try {
            console.log(`[LLM Heading] Fetching new course outline for ${courseId}...`);
            const newContent = await fetchCourseOutline(courseId);
            console.log(newContent)
            // Update cache
            GM.setValue(contentKey, newContent);
            GM.setValue(timestampKey, now);

            console.log("[LLM Heading] Course outline fetched and cached successfully.");
            return newContent;
        } catch (error) {
            console.error(`[LLM Heading] Error fetching course outline for ${courseId}:`, error);
            console.warn(`[LLM Heading] Could not fetch or cache course outline: ${error.message}. Continuing without outline.`);
            alert(`Could not fetch course outline. Is this a Sandbox course?`);
            return null;
        }
    }

    /**
     * Sends the course outline text to Gemini to get a structured JSON object.
     * The result is logged to the console.
     */
    async function extractStructuredData() {
        const courseId = getCourseId();

        if (!courseId) {
            showNotification('Not in a course page. Cannot extract outline.', 'error');
            return;
        }

        showNotification('Fetching outline for JSON extraction...', 'loading');

        // Ensure we fetch the latest outline or use the fresh cache
        const courseOutlineContent = await getOrFetchCourseOutline(courseId);

        if (!courseOutlineContent) {
            showNotification('Failed to get course outline content. See console for errors.', 'error');
            return;
        }

        //console.dir(courseOutlineContent)
        console.log(`Course outline content length: ${courseOutlineContent.length} characters.`);
        console.log(`stopping here`);
        return false;
        const userQuery = `Extract the following structured information from the provided course outline text:\n\n---\n\n${courseOutlineContent.substring(0, MAX_OUTLINE_LENGTH)}`;

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
            const result = await fetchWithBackoff(payload);
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (jsonText) {
                // Remove potential markdown code fences if they slipped through
                const cleanedJsonText = jsonText.replace(/^```json\s*|```\s*$/g, '');

                const structuredData = JSON.parse(cleanedJsonText);
                console.log(`--- Gemini Structured Data for Course ID ${courseId} ---`);
                console.log(structuredData);
                console.log('----------------------------------------------------');
                showNotification('Structured data extracted and logged to console.', 'success');
            } else {
                showNotification('LLM response was empty or malformed (JSON).', 'error');
            }
        } catch (error) {
            console.error('LLM Structured Data Extractor Error:', error);
            showNotification(`Failed to extract structured data: ${error.message}`, 'error');
        }
    }

    /**
     * Main function to extract content and call the API for heading generation.
     */
    async function generateHeading() {
        const courseId = getCourseId();
        let courseOutlineContent = null;

        if (courseId) {
            showNotification('Checking course outline cache...', 'loading');
            courseOutlineContent = await getOrFetchCourseOutline(courseId);
        }

        const pageContent = document.body.innerText;
        const truncatedContent = pageContent.substring(0, MAX_CONTENT_LENGTH);

        if (truncatedContent.length === 0) {
            showNotification('Page content is empty. Cannot generate heading.', 'error');
            return;
        }

        let userQuery = `Task: Create a concise heading for the page content.\n\n`;

        if (courseOutlineContent) {
            // Add the course outline to the query, truncated for brevity/context
            const truncatedOutline = courseOutlineContent.substring(0, MAX_OUTLINE_LENGTH);
            userQuery += `Course Outline Context (${truncatedOutline.length} chars):\n\n---\n\n${truncatedOutline}\n\n`;
        }

        userQuery += `Page Content (${truncatedContent.length} chars):\n\n---\n\n${truncatedContent}`;

        const systemPrompt = PROMPT;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.1
            }
        };

        showNotification('Sending page content and context to LLM...', 'loading');

        try {
            const result = await fetchWithBackoff(payload);
            const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (generatedText) {
                // Clean up punctuation
                const cleanedHeading = generatedText.replace(/['".,!?:;]/g, '').trim();

                // Pass the heading text directly to showNotification
                showNotification(cleanedHeading, 'success');

            } else {
                showNotification('LLM response was empty or malformed.', 'error');
            }
        } catch (error) {
            console.error('LLM Heading Generator Error:', error);
            showNotification(`Failed to generate heading: ${error.message}`, 'error');
        }
    }

    // --- Execution ---

    /**
     * Creates the fixed action buttons (Heading Generator and Data Extractor).
     */
    function createActionButton() {

        // Heading Generator Button
        const headingButton = document.createElement('button');
        headingButton.textContent = 'Generate LLM Heading';
        Object.assign(headingButton.style, {
            padding: '10px 15px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '14px',
            transition: 'background-color 0.3s'
        });
        headingButton.onmouseover = () => { headingButton.style.backgroundColor = '#0056b3'; };
        headingButton.onmouseout = () => { headingButton.style.backgroundColor = '#007bff'; };
        headingButton.onclick = generateHeading;

        // Data Extractor Button (New)
        const extractorButton = document.createElement('button');
        extractorButton.textContent = 'Extract Outline Data';
        Object.assign(extractorButton.style, {
            padding: '10px 15px',
            backgroundColor: '#38bdf8', // Light Blue/Cyan for data action
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '14px',
            transition: 'background-color 0.3s'
        });
        extractorButton.onmouseover = () => { extractorButton.style.backgroundColor = '#0284c7'; };
        extractorButton.onmouseout = () => { extractorButton.style.backgroundColor = '#38bdf8'; };
        extractorButton.onclick = extractStructuredData;

        // Container to hold buttons
        const actionContainer = document.createElement('div');
        actionContainer.id = 'llm-action-container';
        Object.assign(actionContainer.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '9999',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            fontFamily: 'system-ui, sans-serif',
        });

        // Append buttons in a logical order
        actionContainer.appendChild(extractorButton);
        actionContainer.appendChild(headingButton);
        document.body.appendChild(actionContainer);
    }


    // Wait for the document to be fully loaded before adding the button
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        createActionButton();
    } else {
        window.addEventListener('load', createActionButton);
    }

})();