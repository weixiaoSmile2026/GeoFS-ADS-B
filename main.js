// ==UserScript==
// @name         GeoFS ADS-B Loader
// @namespace    geofs.opensky.adsb.loader
// @version      1.0.1
// @description  Load the latest GeoFS ADS-B script from GitHub
// @match        http://*/geofs.php*
// @match        https://*/geofs.php*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      smile-code-test.duckdns.org
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_URL =
        'https://raw.githubusercontent.com/weixiaoSmile2026/GeoFS-ADS-B/main/GeoFS-ADS-B.user.js';

    GM_xmlhttpRequest({
        method: 'GET',
        url: SCRIPT_URL + '?_=' + Date.now(),

        onload: function (response) {
            if (response.status !== 200) {
                console.error(
                    '[GeoFS ADS-B Loader] GitHub 載入失敗：HTTP ' +
                    response.status
                );
                return;
            }

            try {
                eval(response.responseText);

                console.log(
                    '[GeoFS ADS-B Loader] 已載入 GitHub 最新版本'
                );
            } catch (error) {
                console.error(
                    '[GeoFS ADS-B Loader] 執行失敗：',
                    error
                );
            }
        },

        onerror: function (error) {
            console.error(
                '[GeoFS ADS-B Loader] GitHub 連線失敗：',
                error
            );
        }
    });
})();
