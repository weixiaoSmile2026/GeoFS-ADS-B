# ✈️ GeoFS ADS-B Fix & Real-time Radar Tracker

![](https://i.ibb.co/FbTFrFLq/image.png)


An open-source, high-performance solution designed to fix the long-broken native ADS-B tracking in [GeoFS](https://www.geo-fs.com/). 

This project revives real-world flight tracking with a robust multi-source backend, dynamic aircraft type matching, and 60 FPS smooth interpolation for seamless radar visualization.

---

## 🔥 Key Features & Fixes

* **Fixing Long-Broken GeoFS ADS-B**: GeoFS's native ADS-B feature has been non-functional for a long time due to API rate limits and source outages. We solved this by building a multi-source parallel poller (`adsb.lol`, `airplanes.live`) paired with a 45-second TTL memory cache, ensuring 24/7 stable tracking for 10,000+ aircraft without data drops.
* **Aircraft Type Matching**: Automatically parses `icao_type` codes (e.g., `B77W`, `A388`, `C172`) to dynamically render distinct 2D/3D icons for jets, heavy freighters, general aviation, and helicopters instead of a single default icon.
* **60 FPS Smooth Interpolation (Lerp)**：Implements vector linear interpolation for positions and headings in memory. Even with 5-second API refresh intervals, aircraft movement and rotations render smoothly at 60 FPS without stuttering or "teleporting".
* **Performance-Optimized Canvas**: Built on Canvas rendering to maintain smooth panning and zooming. Map transformations stay synchronized with frame rendering, eliminating icon offset bugs.

---

## 💻 Installation & Usage (Tampermonkey)

Players can easily run this enhanced radar in GeoFS without hosting a backend server:

1. **Install Extension**: Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. **Create New Script**: Click the Tampermonkey icon and select **Create a new script**.
3. **Paste Code**: Copy the entire content from [`main.js`](./main.js) in this repository and replace all default text in the editor.
4. **Save**: Press `Ctrl + S` (or `Cmd + S`) to save.

> 💡 **Auto-Update Supported**: The script includes `@updateURL` and `@downloadURL` headers. Whenever new updates are pushed to this GitHub repo, Tampermonkey will automatically update in the background—no manual copying required!

---

## 📡 API Data Structure

The backend filters and outputs clean JSON payload:

```json
{
  "aircraft": [
    {
      "icao24": "7812ab",
      "callsign": "EVA191",
      "icao_type": "B77W",
      "lat": 25.0777,
      "lon": 121.2333,
      "alt": 35000,
      "speed": 460,
      "heading": 220,
      "on_ground": false
    }
  ]
}

```

## 💬 Community & Support
Have questions, bug reports, or feature requests? Join our community on Discord:
👉 [Join our Discord Server](https://discord.gg/wy9cRdmDeF)

## 📄 License
Distributed under the Apache License 2.0. See LICENSE for more information.
