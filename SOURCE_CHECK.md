# Source check — ✅ all clear

Checked 2026-10-12 20:25 UTC against https://www.landfalltracker.org

| | Check | Result |
|---|---|---|
| ✅ | Sources: NHC active-storm list | 1 active: Simon |
| ✅ | Sources: NOAA forecast map service (layer names) | 400 layers, all expected names present |
| ✅ | Sources: NOAA forecast map service (query) | GeoJSON OK (0 features in slot AT1) |
| ✅ | Sources: NHC advisory text reader (saved sample) | reads location, warnings, surge, next advisory |
| ✅ | Sources: NHC advisory text: Simon | advisory 21A: 20.2N 106.6W |
| ✅ | Sources: National Weather Service alerts | 0 alerts at test point |
| ✅ | Sources: Census address lookup | 1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500 |
| ✅ | Sources: USGS base map tiles | tile image OK |
| ✅ | Live site: Home page | https://www.landfalltracker.org OK |
| ✅ | Live site: Storm list helper | 1 storms |
| ✅ | Live site: Forecast helper: Simon | 8 points, cone yes — crossing 23.54, -106.67 |
| ✅ | Live site: Address lookup helper | 1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500 |
| ✅ | Live site: Coastal places file | 3985 places |
