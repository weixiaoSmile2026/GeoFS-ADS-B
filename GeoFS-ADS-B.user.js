// ==UserScript==
// @name         GeoFS ADS-B
// @author       Smile and SeaBus
// @namespace    geofs.opensky.adsb.selfhosted
// @version      1.3.0
// @description  ADS-B can be used in GeoFS (Depth Tested Labels)
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
        POLL_INTERVAL_MS: 20000,
        INTERPOLATION_TICK_MS: 150,
        STALE_REMOVE_MS: 27000,
        DISPLAY_RADIUS_KM: 50,
        MODEL_SCALE: 1.0,
        MODEL_MIN_PIXEL_SIZE: 48,
        SHOW_LABEL: true,
        ENABLED: true
    };

    const LOG = (...a) => console.log('%c[GeoFS-ADSB-Self]', 'color:#0af;font-weight:bold', ...a);
    const WARN = (...a) => console.warn('%c[GeoFS-ADSB-Self]', 'color:#f80;font-weight:bold', ...a);

    let geofs, Cesium, viewer;
    let isEnabled = CONFIG.ENABLED;
    const tracked = new Map();
    let fetchInFlight = false;

    function waitForGeoFS(cb) {
        const timer = setInterval(() => {
            const g = unsafeWindow.geofs;
            if (g && g.aircraft && g.aircraft.instance && g.aircraft.instance.llaLocation && g.api && g.api.viewer && unsafeWindow.Cesium && g.aircraftList) {
                clearInterval(timer);
                geofs = g;
                Cesium = unsafeWindow.Cesium;
                viewer = g.api.viewer;
                cb();
            }
        }, 500);
    }

    const modelUriCache = new Map();
    function resolveModelUri(aircraftId) {
        if (modelUriCache.has(aircraftId)) return modelUriCache.get(aircraftId);
        const rec = geofs.aircraftList[aircraftId];
        if (!rec) {
            WARN('找不到機型 ID ' + aircraftId);
            modelUriCache.set(aircraftId, null);
            return null;
        }
        const files = rec.multiplayerFiles ? rec.multiplayerFiles.split(',') : ['multiplayer.glb', 'multiplayer-low.glb'];
        const uri = geofs.url + rec.path + files[0].trim();
        modelUriCache.set(aircraftId, uri);
        return uri;
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

    function resolveGroundAltitude(lat, lon) {
        try {
            if (geofs.api && typeof geofs.api.getGroundAltitude === 'function') {
                const h = geofs.api.getGroundAltitude([lat, lon, 0]);
                if (typeof h === 'number' && isFinite(h)) return h;
            }
        } catch (e) {}
        try {
            const carto = Cesium.Cartographic.fromDegrees(lon, lat);
            const h = viewer.scene.globe.getHeight(carto);
            if (typeof h === 'number' && isFinite(h)) return h;
        } catch (e) {}
        return null;
    }

    function fetchFromServer() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: CONFIG.SERVER_URL + '?_=' + Date.now(),
                onload: (res) => {
                    if (res.status !== 200) { reject(new Error('HTTP ' + res.status)); return; }
                    try {
                        resolve(JSON.parse(res.responseText));
                    } catch (e) { reject(e); }
                },
                onerror: reject,
            });
        });
    }

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

    function createEntity(icao24, callsign, aircraftId) {
        const modelUri = resolveModelUri(aircraftId);
        return viewer.entities.add({
            id: 'geofs-adsb-' + icao24,
            position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
            model: modelUri
                ? { uri: modelUri, scale: CONFIG.MODEL_SCALE, minimumPixelSize: CONFIG.MODEL_MIN_PIXEL_SIZE }
                : undefined,
            box: modelUri
                ? undefined
                : { dimensions: new Cesium.Cartesian3(38, 34, 12), material: Cesium.Color.YELLOW.withAlpha(0.5), outline: true, outlineColor: Cesium.Color.BLACK },
            label: CONFIG.SHOW_LABEL
                ? {
                      text: ' ' + callsign.trim() + ' ',
                      font: 'bold 15px "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                      fillColor: Cesium.Color.WHITE,
                      outlineColor: Cesium.Color.BLACK,
                      outlineWidth: 4,
                      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                      showBackground: true,
                      backgroundColor: new Cesium.Color(0.08, 0.08, 0.08, 0.65),
                      backgroundPadding: new Cesium.Cartesian2(8, 5),
                      pixelOffset: new Cesium.Cartesian2(0, -35),
                      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,

                      // 1. 關閉無限深度穿越：改為 0（或是完全不寫），開啟正常的 3D 遮擋測試
                      //    這能防止標籤穿透你自己的駕駛艙或飛機模型
                      disableDepthTestDistance: 0,

                      // 2. 將標籤稍微向鏡頭推進 2 公尺，防止被該 ADS-B 飛機自身的 3D 模組邊緣切掉
                      eyeOffset: new Cesium.Cartesian3(0, 0, -2.0),

                      scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 50000, 0.6)
                  }
                : undefined,
        });
    }

    function clearAllEntities() {
        tracked.forEach((t2) => {
            viewer.entities.remove(t2.entity);
        });
        tracked.clear();
    }

    function toggleADSB(enable) {
        isEnabled = enable !== undefined ? enable : !isEnabled;
        if (!isEnabled) {
            clearAllEntities();
            LOG('ADS-B 已關閉');
        } else {
            LOG('ADS-B 已開啟');
            runFetchCycle();
        }
    }

    function createUI() {
        const btn = document.createElement('button');
        btn.innerHTML = isEnabled ? 'ADS-B: ON' : 'ADS-B: OFF';
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '10000';
        btn.style.padding = '6px 12px';
        btn.style.backgroundColor = isEnabled ? '#28a745' : '#dc3545';
        btn.style.color = '#ffffff';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = 'bold';
        btn.style.fontFamily = 'sans-serif';

        btn.onclick = () => {
            toggleADSB();
            btn.innerHTML = isEnabled ? 'ADS-B: ON' : 'ADS-B: OFF';
            btn.style.backgroundColor = isEnabled ? '#28a745' : '#dc3545';
        };

        document.body.appendChild(btn);
    }

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
                    if (st.on_ground) {
                        const groundAlt = resolveGroundAltitude(st.lat, st.lon);
                        if (groundAlt !== null) st.alt = groundAlt + 5;
                    }
                });

                const nearbyIds = new Set(list.map((st) => st.icao24));

                list.forEach((st) => {
                    const existing = tracked.get(st.icao24);
                    const prevSnap = existing ? interpolatedSnapshot(existing, now) : { lat: st.lat, lon: st.lon, alt: st.alt, heading: st.heading };

                    if (existing) {
                        existing.prev = prevSnap;
                        existing.next = st;
                        existing.fetchedAt = now;
                        existing.lastSeenAt = now;
                        existing.callsign = st.callsign;
                    } else {
                        const entity = createEntity(st.icao24, st.callsign, st.geofs_aircraft_id);
                        tracked.set(st.icao24, {
                            entity,
                            prev: prevSnap,
                            next: st,
                            fetchedAt: now,
                            lastSeenAt: now,
                            callsign: st.callsign,
                            liveryIndex: st.livery_index,
                        });
                    }
                });

                tracked.forEach((t2, id) => {
                    const tooStale = now - t2.lastSeenAt > CONFIG.STALE_REMOVE_MS;
                    const outOfRange = !nearbyIds.has(id);
                    if (tooStale || outOfRange) {
                        viewer.entities.remove(t2.entity);
                        tracked.delete(id);
                    }
                });

                LOG(`伺服器共 ${data.aircraft ? data.aircraft.length : 0} 架全球航班，範圍 ${CONFIG.DISPLAY_RADIUS_KM}km 內 ${list.length} 架，畫面上共 ${tracked.size} 架`);
            })
            .catch((e) => WARN('連線伺服器失敗：', e.message || e))
            .finally(() => { fetchInFlight = false; });
    }

    function runInterpolationTick() {
        if (!isEnabled || tracked.size === 0) return;
        const now = Date.now();

        tracked.forEach((t2) => {
            const snap = interpolatedSnapshot(t2, now);
            const position = Cesium.Cartesian3.fromDegrees(snap.lon, snap.lat, snap.alt);
            const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(snap.heading), 0, 0);
            t2.entity.position = position;
            t2.entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
            if (t2.entity.label && t2.entity.label.text.getValue() !== ' ' + t2.callsign.trim() + ' ') {
                t2.entity.label.text = ' ' + t2.callsign.trim() + ' ';
            }
        });
    }

    waitForGeoFS(() => {
        if (CONFIG.SERVER_URL.includes('你的主機IP或網域')) {
            WARN('還沒填 SERVER_URL，改成你 Linux Mint 主機的實際位址。');
            return;
        }
        LOG(`啟動。每 ${CONFIG.POLL_INTERVAL_MS / 1000} 秒向 ${CONFIG.SERVER_URL} 拿一次資料。`);

        createUI();
        unsafeWindow.toggleADSB = toggleADSB;

        runFetchCycle();
        setInterval(runFetchCycle, CONFIG.POLL_INTERVAL_MS);
        setInterval(runInterpolationTick, CONFIG.INTERPOLATION_TICK_MS);
    });
})();
