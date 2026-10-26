# Source check — ✅ all clear

Checked 2026-10-26 17:38 UTC against https://www.landfalltracker.org

| | Check | Result |
|---|---|---|
| ✅ | Sources: NHC active-storm list | 2 active: Vance, Olana |
| ✅ | Sources: NOAA forecast map service (layer names) | 400 layers, all expected names present |
| ✅ | Sources: NOAA forecast map service (query) | GeoJSON OK (0 features in slot AT1) |
| ✅ | Sources: NHC advisory text reader (saved sample) | reads location, warnings, surge, next advisory |
| ✅ | Sources: NHC advisory text: Vance | advisory 21: 15.4N 105.7W |
| ✅ | Sources: NHC advisory text: Olana | advisory 5: 13.9N 176.8W |
| ✅ | Sources: National Weather Service alerts | 1 alerts at test point |
| ✅ | Sources: Census address lookup | 1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500 |
| ✅ | Sources: USGS base map tiles | tile image OK |
| ✅ | Live site: Home page | https://www.landfalltracker.org OK |
| ✅ | Live site: Storm list helper | 2 storms |
| ✅ | Live site: Forecast helper: Vance | 8 points, cone yes — no-crossing |
| ✅ | Live site: Forecast helper: Olana | 5 points, cone yes — no-crossing |
| ✅ | Live site: Address lookup helper | 1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500 |
| ✅ | Live site: Coastal places file | 3985 places |
