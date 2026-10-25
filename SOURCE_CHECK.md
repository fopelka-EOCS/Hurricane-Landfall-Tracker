# Source check — ✅ all clear

Checked 2026-10-25 19:51 UTC against https://www.landfalltracker.org

| | Check | Result |
|---|---|---|
| ✅ | Sources: NHC active-storm list | 2 active: Vance, Three-C |
| ✅ | Sources: NOAA forecast map service (layer names) | 400 layers, all expected names present |
| ✅ | Sources: NOAA forecast map service (query) | GeoJSON OK (0 features in slot AT1) |
| ✅ | Sources: NHC advisory text reader (saved sample) | reads location, warnings, surge, next advisory |
| ✅ | Sources: NHC advisory text: Vance | advisory 17: 14.3N 103.8W |
| ✅ | Sources: NHC advisory text: Three-C | advisory 1: 14.6N 179.3W |
| ✅ | Sources: National Weather Service alerts | 1 alerts at test point |
| ✅ | Sources: Census address lookup | 1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500 |
| ✅ | Sources: USGS base map tiles | tile image OK |
| ✅ | Live site: Home page | https://www.landfalltracker.org OK |
| ✅ | Live site: Storm list helper | 2 storms |
| ✅ | Live site: Forecast helper: Vance | 9 points, cone yes — no-crossing |
| ✅ | Live site: Forecast helper: Three-C | 7 points, cone yes — no-crossing |
| ✅ | Live site: Address lookup helper | 1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500 |
| ✅ | Live site: Coastal places file | 3985 places |
