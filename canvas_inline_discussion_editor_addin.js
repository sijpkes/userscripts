// ==UserScript==
// @name         Inline discussion for Canvas Editor
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replaces anchor with class ps_inline_discussion with embedded discussion
// @author       PS
// @match        https://canvas.newcastle.edu.au/courses/*/pages/*/edit
// @icon         https://www.google.com/s2/favicons?sz=64&domain=newcastle.edu.au
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    console.log("Discussion iFrame injector")

    const disc_iframe = document.createElement("iframe")
    disc_iframe.classList.add("ps_inline_discussion")
    disc_iframe.width = "100%"
    disc_iframe.height = "800"
    disc_iframe.dataApiEndpoint = ""
    disc_iframe.dataApiReturntype = "Discussion"

    const _intv = setInterval(() => {
        let tinymce = document.getElementById("wiki_page_body_ifr");
        let disc_anchor = tinymce.contentWindow.document.querySelector("a.ps_embed_discussion")
        console.log("TICK")
        if(disc_anchor) {
            disc_iframe.src = String(disc_anchor.href) + "?embedded=true"
            console.log("found....")
            disc_iframe.src = disc_anchor.href
            disc_anchor.parentNode.replaceChild(disc_iframe, disc_anchor)
            clearInterval(_intv)
        }

    }, 250)
})();