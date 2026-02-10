// ==UserScript==
// @name         Inline Discussion
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Inline discussions
// @author       PS
// @match        https://canvas.newcastle.edu.au/courses/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=newcastle.edu.au
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';
    
    /*<iframe class="ps_inline_discussion" src="https://canvas.newcastle.edu.au/courses/2016/discussion_topics/114633#entry-188695" width="100%" height="800" data-api-endpoint="https://canvas.newcastle.edu.au/api/v1/courses/2016/discussion_topics/85083#entry-188695" data-api-returntype="Discussion"></iframe>*/
    const disc_iframe = document.createElement("iframe")
    disc_iframe.classList.add("ps_inline_discussion")
    disc_iframe.width = "100%"
    disc_iframe.height = "800"
    disc_iframe.dataApiEndpoint = ""
    disc_iframe.dataApiReturntype = "Discussion"

    let _intv = setInterval(() => {
        
        let disc_anchor = document.getElementsByClassName("ps_inline_discussion")[0]

        if(disc_anchor) {
            disc_iframe.src = a.href
       
            const body = disc_iframe.contentWindow.document.getElementsByTagName("body")[0]
            const _fr_document = disc_iframe.contentWindow.document

            const disc_box = _fr_document.getElementById("discussion_container")
            if(disc_box) {

                if(disc_box.children[1]) {
                    disc_box.children[1].style.marginTop = "-800px";

                    _fr_document.getElementById("mobile-header").style.display = "none";
                    _fr_document.getElementById("header").style.visibility = "hidden";
                    _fr_document.getElementById("header").style.height = "0";
                    _fr_document.getElementById("header").style.width = "0";
                    _fr_document.getElementById("wrapper").style.visibility = "hidden";
                    _fr_document.getElementById("wrapper").style.height = "0";
                    _fr_document.getElementById("wrapper").style.width = "0";
                    _fr_document.getElementById("main").style.display = "none";

                    const content = _fr_document.getElementById("application")
                    const box = disc_box.children[1]
                    //content.style.height = "0px"
                    content.appendChild(box)

      

                        body.style.visibility = "visible"
                       clearInterval(_intv)
                 
                }
            }
        }

    }, 1000);


})();