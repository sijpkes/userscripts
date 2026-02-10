// ==UserScript==
// @name         Inline discussion thread
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Formats embedded iframe inline discussion in a page
// @author       PS
// @match        https://canvas.newcastle.edu.au/courses/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=newcastle.edu.au
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const applyCSSChanges = function(disc_iframe, inter = null) {
        if(!disc_iframe) return false;

        if(disc_iframe) {
            const arr = disc_iframe.src.split("#")
            const id = arr[1].split('?')[0]
            disc_iframe.style.visibility = "hidden"

            const body = disc_iframe.contentWindow.document.getElementsByTagName("body")[0]

            if(!body) return false;

            const _fr_document = disc_iframe.contentWindow.document

            const disc_box = _fr_document.getElementById("discussion_container")

            if(disc_box) {
                if(disc_box.children[1]) {

                     console.log("ID>> ", id)

                    _fr_document.getElementsByClassName('entry-content')[0].style.display = "none"

                    _fr_document.getElementsByClassName('ic-app-nav-toggle-and-crumbs')[0].style.display = "none"
                    _fr_document.getElementById("mobile-header").style.display = "none";
                    _fr_document.getElementById("discussion-managebar").style.display = "none";
                    _fr_document.getElementById("discussion-toolbar").style.display = "none";
                    _fr_document.getElementById("left-side").style.display = "none";
                    _fr_document.getElementById("header").style.display = "none";
                    const ra = _fr_document.getElementsByClassName('discussion-entry-reply-area')[0]

                    if(ra) {
                        ra.style.display = "none"
                    }

                    const _sub = _fr_document.getElementById("discussion_subentries")

                    if(_sub) {
                        _sub.style.padding = "0"
                        // _sub.style.marginLeft = "-16px"
                    }
                }
            }

            const ul = _fr_document.querySelectorAll("#discussion_container > div.discussion_subentries > ul.discussion-entries > li")
            const hcl = _fr_document.querySelectorAll("div.discussion-pubdate")

            const applyReplyStyles = function(el, is_reply = false) {
                el.parentElement.style.border = "0";

               // el.style.backgroundColor = '#ecf8f8'
              //  el.style.borderRadius = "1em"
               // el.style.borderColor = "purple"

                let ls = el.querySelectorAll(".discussion-fyi")
                ls.forEach((o) => {
                    o.style.display = "none"
                })

                ls = el.querySelectorAll("a.avatar")
                ls.forEach((o) => {
                    o.classList.remove('avatar')
                    // av.style.marginLeft = "-21px";
                })

                ls = el.parentElement.querySelectorAll("a.discussion-read-state-btn")
                ls.forEach((o) => {
                    o.style.display= "none";
                });

                ls = el.querySelectorAll(".discussion-title")
                ls.forEach((o) => {

                    o.style.marginLeft = "-16px";
                });

                ls = el.querySelectorAll(".discussion-rate-action");
                ls.forEach((o) => {
                    o.style.float = "right";
                });
            }

            ul.forEach((el) => {
                if(el.id !== id) {
                    el.style.display = 'none'
                } else {
                    applyReplyStyles(el.firstChild)

                    el.querySelectorAll("li > article > .entry-content").forEach( el => applyReplyStyles(el) )
                }

            })

            hcl.forEach((el) => {
                el.style.marginLeft = "-16px";
            })

            if(ul.length > 0) {
                const _h = _fr_document.querySelectorAll("#"+id+" .discussion_entry > .entry-content > header")[0]

                _h.style.display = 'none'
              

                const dc = _fr_document.getElementById("discussion_container")
                const app = _fr_document.getElementById("application")

                dc.style.marginLeft = "-24px"
                app.prepend(dc)

                disc_iframe.style.visibility = "visible"
                if(inter) clearInterval(inter)
            }
        }
    }

    let _intv = setInterval(() => {

        let iframe = document.getElementsByClassName("ps_inline_discussion")[0]
        applyCSSChanges(iframe, _intv);

        /*iframe.addEvenListener('load', (e) => {
               applyCSSChanges(iframe);
        })*/

    }, 250);

})();