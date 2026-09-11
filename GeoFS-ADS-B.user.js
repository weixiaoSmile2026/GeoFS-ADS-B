// ==UserScript==
// @name         GeoFS ADS-B (原生渲染版)
// @author       Smile and SeaBus
// @namespace    geofs.opensky.adsb.selfhosted.native
// @version      1.0.0
// @description  向自架中央伺服器拿真實航班資料，直接餵給 GeoFS 原生的 multiplayer 系統渲染（模型/標籤/地面高度校正都交給遊戲自己處理）。注意：受限於 GeoFS 內建 10 公里模型可視距離。
// @match        http://*/geofs.php*
// @match        https://*/geofs.php*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        SERVER_URL: "https://smile-code-test.duckdns.org/geofs-adsb/latest.json",
        POLL_INTERVAL_MS: 20000,       // 多久跟伺服器拿一次新資料
        INTERPOLATION_TICK_MS: 150,    // 多久把插值後的座標餵給 GeoFS 原生系統一次
        DISPLAY_RADIUS_KM: 50,         // 篩選範圍（注意：GeoFS 原生系統本身還會再用 10km/50km 的規則決定要不要真的顯示模型）
        ENABLED: true,
    };

    const LOG = (...a) => console.log('%c[GeoFS-ADSB-Native]', 'color:#0af;font-weight:bold', ...a);
    const WARN = (...a) => console.warn('%c[GeoFS-ADSB-Native]', 'color:#f80;font-weight:bold', ...a);

    let geofs, multiplayer;
    let isEnabled = CONFIG.ENABLED;

    function waitForGeoFS(cb) {
        const timer = setInterval(() => {
            const g = unsafeWindow.geofs;
            const mp = unsafeWindow.multiplayer;
            if (g && mp && g.aircraft && g.aircraft.instance && g.aircraft.instance.llaLocation && g.aircraftList) {
                clearInterval(timer);
                geofs = g;
                multiplayer = mp;
                cb();
            }
        }, 500);
    }

    function angleLerp(a, b, t) {
        let diff = ((b - a + 540) % 360) - 180;
        return (a + diff * t + 360) % 360;
    }
    function lerp(a, b, t) { return a + (b - a) * t; }

    function distanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function fetchFromServer() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: CONFIG.SERVER_URL + '?_=' + Date.now(),
                onload: (res) => {
                    if (res.status !== 200) { reject(new Error('HTTP ' + res.status)); return; }
                    try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); }
                },
                onerror: reject,
            });
        });
    }

    // ---------- 追蹤中的航班 ----------
    // tracked[icao24] = { prev, next, fetchedAt, callsign, aircraftId }
    const tracked = new Map();

    function interpolatedSnapshot(t2, now) {
        const t = Math.min(1, (now - t2.fetchedAt) / CONFIG.POLL_INTERVAL_MS);
        const p = t2.prev, n = t2.next;
        return {
            lat: lerp(p.lat, n.lat, t),
            lon: lerp(p.lon, n.lon, t),
            alt: lerp(p.alt, n.alt, t),
            heading: angleLerp(p.heading, n.heading, t),
        };
    }

    let fetchInFlight = false;
    function runFetchCycle() {
        if (!isEnabled || fetchInFlight) return;
        fetchInFlight = true;

        fetchFromServer()
            .then((data) => {
                if (!isEnabled) return;
                const now = Date.now();
                const playerLoc = geofs.aircraft.instance.llaLocation;

                const list = (data.aircraft || []).filter(
                    (st) => distanceKm(playerLoc[0], playerLoc[1], st.lat, st.lon) <= CONFIG.DISPLAY_RADIUS_KM
                );

                list.forEach((st) => {
                    const existing = tracked.get(st.icao24);
                    const prevSnap = existing ? interpolatedSnapshot(existing, now) : { lat: st.lat, lon: st.lon, alt: st.alt, heading: st.heading };

                    tracked.set(st.icao24, {
                        prev: prevSnap,
                        next: st,
                        fetchedAt: now,
                        callsign: st.callsign,
                        aircraftId: st.geofs_aircraft_id,
                        onGround: st.on_ground,
                        speedMs: st.speed_ms,
                    });
                });

                // 範圍外的直接停止追蹤（不用手動清 GeoFS 那邊的物件，
                // 原生系統偵測到 20~40 秒沒再收到更新會自動淡出移除）
                const nearbyIds = new Set(list.map((st) => st.icao24));
                tracked.forEach((_, id) => {
                    if (!nearbyIds.has(id)) tracked.delete(id);
                });

                LOG(`伺服器共 ${data.aircraft ? data.aircraft.length : 0} 架全球航班，範圍 ${CONFIG.DISPLAY_RADIUS_KM}km 內 ${list.length} 架`);
            })
            .catch((e) => WARN('連線伺服器失敗：', e.message || e))
            .finally(() => { fetchInFlight = false; });
    }

    // ---------- 插值渲染迴圈：把算好的座標餵回 GeoFS 原生的 multiplayer 系統 ----------
    function runInterpolationTick() {
        if (!isEnabled || tracked.size === 0) return;
        const now = Date.now();
        const updates = [];

        tracked.forEach((t2, icao24) => {
            const snap = interpolatedSnapshot(t2, now);
            updates.push({
                id: 'adsb-' + icao24,
                ad: true,           // 標記成 ADS-B，沿用 GeoFS 既有的開關判斷邏輯（geofs.preferences.adsb）
                cs: t2.callsign,
                ac: t2.aircraftId,  // GeoFS 機型 ID，交給原生系統自己去載入對應模型
                co: [snap.lat, snap.lon, snap.alt, snap.heading, 0, 0], // [lat, lon, alt, heading, pitch, roll]
                ve: [0, 0, 0, 0, 0, 0], // 速度交給我們自己的插值處理，這裡固定 0 避免原生系統再做一次外插
                st: {
                    gr: t2.onGround,   // 這個 flag 是 true 的話，原生系統會自動幫這架飛機校正到正確地面高度
                    as: Math.round((t2.speedMs || 0) * 1.94384), // m/s -> knots
                },
                ti: multiplayer.getServerTime ? multiplayer.getServerTime() : now,
            });
        });

        multiplayer.updateUsers(updates);
    }

    function toggleADSB(enable) {
        isEnabled = enable !== undefined ? enable : !isEnabled;
        LOG(isEnabled ? 'ADS-B 已開啟' : 'ADS-B 已關閉（現有飛機會在 20~40 秒內自然淡出消失）');
        if (isEnabled) runFetchCycle();
    }

    function createUI() {
        const btn = document.createElement('button');
        btn.innerHTML = isEnabled ? 'ADS-B: ON' : 'ADS-B: OFF';
        Object.assign(btn.style, {
            position: 'absolute', top: '10px', right: '10px', zIndex: '10000',
            padding: '6px 12px', backgroundColor: isEnabled ? '#28a745' : '#dc3545',
            color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer',
            fontWeight: 'bold', fontFamily: 'sans-serif',
        });
        btn.onclick = () => {
            toggleADSB();
            btn.innerHTML = isEnabled ? 'ADS-B: ON' : 'ADS-B: OFF';
            btn.style.backgroundColor = isEnabled ? '#28a745' : '#dc3545';
        };
        document.body.appendChild(btn);
    }

    waitForGeoFS(() => {
        LOG(`啟動（原生渲染版）。每 ${CONFIG.POLL_INTERVAL_MS / 1000} 秒向伺服器拿一次資料。`);
        createUI();
        unsafeWindow.toggleADSB = toggleADSB;

        runFetchCycle();
        setInterval(runFetchCycle, CONFIG.POLL_INTERVAL_MS);
        setInterval(runInterpolationTick, CONFIG.INTERPOLATION_TICK_MS);
    });
})();
