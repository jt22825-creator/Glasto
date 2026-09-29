// ==UserScript==
// @name         Ticket Queue Helper
// @namespace    https://github.com/jt22825-creator/glasto
// @version      2.0.0
// @description  Watches the ticket tab YOU opened: shows queue state, alarms when the booking page appears, blocks accidental refreshes while queued, reports to your group dashboard, and keeps checkout details one click away. Never clicks, fills or submits anything on the ticket site.
// @match        *://*.seetickets.com/*
// @match        *://*.queue-it.net/*
// @include      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/mock\/.*$/
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_registerMenuCommand
// @connect      ntfy.sh
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==
//
// GENERATED FILE — edit userscript/src/ and shared/, then run `npm run build`.
