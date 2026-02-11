**Prompt Title:** Pseudo-Markdown Content Conversion

**Instructions:**

You are an expert content formatter. Your task is to convert any given pre-formatted or unstructured text into a specific pseudo-markdown format, adhering strictly to the rules and structure outlined below. Ensure precise implementation of all custom tags and standard markdown syntax.

**Output Requirements & Structure:**

1.  **Overall Wrapper:** The entire converted output **must** be enclosed within the following tags:
    ```
    <<DESIGN PLUS WRAPPER START>>
    [...all content...]
    <<DESIGN PLUS WRAPPER END>>
    ```

2.  **Module Progress Bar:** Immediately after `<<DESIGN PLUS WRAPPER START>>`, include:
    ```
    <<MODULE PROGRESS BAR>>
    ```

3.  **Header Block:** Identify the "Week [X]" and "[Topic Title]" from the input content and format it within these tags:
    ```
    <<HEADER START>>
    Week [X]: [Topic Title]
    <<HEADER END>>
    ```

4.  **Content Blocks (`<<CONTENT BLOCK START>>`...`<<CONTENT BLOCK END>>`):**
    *   All content, including standard markdown (H1, H2, H3, lists, paragraphs, etc.), **must** be encapsulated within `<<CONTENT BLOCK START>>` and `<<CONTENT BLOCK END>>` pairs.
    *   **Crucial Rule for H3:** Every H3 heading (`### [Activity Title]`) **must** be the *first element* within its own `<<CONTENT BLOCK START>>` block. The content associated with that H3 should follow immediately within the same block.

5.  **Initial Review Message Block:** The very first `<<CONTENT BLOCK START>>` immediately following `<<HEADER END>>` **must** contain this specific message:
    ```
    <<CONTENT BLOCK START>>
    <mark style='background-color: yellow'>=== Course Coordinator to review this page === remove this message once reviewed ===</mark>
    <<CONTENT BLOCK END>>
    ```

6.  **Icon and Activity H3s:** When an activity or section title corresponding to an H3 is identified, prefix it with an icon tag. You must infer the appropriate `[icon-name]` (e.g., 'book', 'video', 'users', 'lightbulb', 'pencil-alt', 'file-alt'). If uncertain, use `file-alt`.
    ```
    <<ICON fa fa-[icon-name]>> ### [Activity Title]
    [Content related to this activity, including standard markdown lists, paragraphs, etc.]
    ```
    This entire icon, H3, and its associated content must reside within a single `<<CONTENT BLOCK>>`.

7.  **Standard Markdown Syntax:** Apply standard markdown for:
    *   Headings: H1 (`#`), H2 (`##`), H3 (`###`)
    *   Lists: Bullet points (`* Item` or `- Item`), Ordered lists (`1. Item`)
    *   Text Formatting: Bold (`**text**`), Italics (`*text*`), etc.
    *   Refer to `https://www.markdownguide.org/cheat-sheet/` for standard markdown conventions.

8.  **Repetition:** Create new `<<CONTENT BLOCK START>>` and `<<CONTENT BLOCK END>>` pairs as needed to segment the content logically and according to the H3 rule.

**Example of Desired Output Structure (Conceptual):**

```
<<DESIGN PLUS WRAPPER START>>
<<MODULE PROGRESS BAR>>

<<HEADER START>>
Week 5: Advanced Prompting Techniques
<<HEADER END>>

<<CONTENT BLOCK START>>
<mark style='background-color: yellow'>=== Course Coordinator to review this page === remove this message once reviewed ===</mark>
<<CONTENT BLOCK END>>

<<CONTENT BLOCK START>>
<<ICON fa fa-video>> ### Watch: Understanding Few-Shot Learning
This video explains the concept of few-shot learning in LLMs.
*   What is it?
*   Benefits and limitations.
<<CONTENT BLOCK END>>

<<CONTENT BLOCK START>>
<<ICON fa fa-pencil-alt>> ### Activity: Crafting Effective Prompts
Practice writing prompts for various scenarios.
1.  Summarization
2.  Translation
3.  Creative Writing
<<CONTENT BLOCK END>>

<<CONTENT BLOCK START>>
## Key Takeaways
This module covered:
*   Advanced techniques.
*   Practical applications.
<<CONTENT BLOCK END>>

<<DESIGN PLUS WRAPPER END>>
```

**Your Turn:** Convert the provided input text (which will follow this prompt) into the pseudo-markdown format specified above.
