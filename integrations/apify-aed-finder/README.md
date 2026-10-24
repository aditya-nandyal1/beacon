# Beacon AED & Emergency Resource Finder (Apify actor)

**Input:** `{ lat, lng, radiusM?, kinds?, includeRegistries? }`
**Output:** dataset rows `{ kind, name, lat, lng, distanceM, address?, details, source }`, nearest first, de-duplicated.

Sources: OpenStreetMap (Overpass, with mirror fallback) + city open-data AED registries (DataSF today; add more in `REGISTRIES`). No logins, no personal data.

Beacon calls this with `run-sync-get-dataset-items` the moment a cardiac incident opens, so the voice coach can say *"there's an AED at the front desk, forty metres away"* instead of *"find an AED"*. The actor is generic enough for any safety app, which is why it's published separately.

```bash
apify run -i '{"lat":37.7694,"lng":-122.4862,"kinds":["aed","hospital"]}'
apify push
```
