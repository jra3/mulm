# IUCN API Synonym Support Research

**Date:** October 28, 2025
**Author:** Claude
**Status:** Research Complete

## Executive Summary

The IUCN Red List API v3 (which included a `/species/synonym/{name}` endpoint) was completely shut down in March 2025. The current v4 API **does not include a dedicated synonym endpoint**. This significantly impacts our planned feature for synonym detection and canonical name recommendations.

## Findings

### V3 API Status

- **Deprecated:** March 27, 2025 (after 2025-1 Red List update)
- **Endpoint that existed:** `/api/v3/species/synonym/{name}`
- **Current Status:** Completely shut down, returns errors
- **Code Impact:** The existing `checkSynonym()` method in `src/integrations/iucn.ts` (line 337) **will not work**

### V4 API Status

- **Current Version:** 2025-2
- **Base URL:** `https://api.iucnredlist.org/api/v4/`
- **OpenAPI Spec:** https://api.iucnredlist.org/api-docs/v4/openapi.yaml

**Available V4 Endpoints (Taxa-related):**
- `GET /api/v4/taxa/sis/{sis_id}`
- `GET /api/v4/taxa/scientific_name` (query params: genus_name, species_name, infra_name)
- `GET /api/v4/taxa/kingdom/`
- `GET /api/v4/taxa/phylum/`
- `GET /api/v4/taxa/class/`
- `GET /api/v4/taxa/order/`
- `GET /api/v4/taxa/family/`
- `GET /api/v4/assessment/{assessment_id}`

**No synonym-specific endpoints exist in v4.**

## Alternative Approaches

Since v4 doesn't have a dedicated synonym endpoint, we have several options:

### Option 1: Indirect Synonym Detection (Recommended)

Query the main taxa endpoint and compare the returned name with the queried name:

```typescript
// Query: genus="Pseudotropheus", species="zebra"
// If IUCN has renamed this to Maylandia zebra:
// Response will contain: taxon.scientific_name = "Maylandia zebra"
//
// Detection: if (response.taxon.genus_name !== queryGenus) {
//   // This is likely a synonym, genus has changed
//   // Create recommendation to update to IUCN's accepted name
// }
```

**Pros:**
- Uses existing v4 API
- Detects genus-level changes (common in fish taxonomy)
- No additional API calls needed
- Works within rate limits

**Cons:**
- Only detects if IUCN has the species under a different name
- Won't detect if our name isn't in IUCN at all vs. being a synonym
- Doesn't explicitly confirm synonym relationship

### Option 2: Fuzzy Search + Comparison (Not Recommended)

Use genus/family endpoints to search for similar species names and compare:

**Pros:**
- Might find renamed species

**Cons:**
- Very imprecise
- Multiple API calls (rate limiting issues)
- High false positive rate
- Computationally expensive

### Option 3: External Taxonomy Database (Future Enhancement)

Integrate with other taxonomy databases that track synonyms:

- **WoRMS** (World Register of Marine Species) - has comprehensive synonym data
- **FishBase** - fish-specific, includes synonyms
- **ITIS** (Integrated Taxonomic Information System)
- **GBIF** (Global Biodiversity Information Facility)

**Pros:**
- Comprehensive synonym coverage
- Dedicated synonym endpoints

**Cons:**
- Requires additional API integration
- Additional API keys
- More complex implementation
- Different rate limits to manage

## Recommended Implementation

**For this feature, implement Option 1** (Indirect Synonym Detection):

1. When syncing IUCN data, compare queried name with returned name
2. If genus or species differs, create a canonical name recommendation
3. Store reason: "IUCN records this species as {accepted_name}"
4. Allow admin review before applying changes

**Example Flow:**

```
Our database: "Pseudotropheus zebra"
  ↓ Query v4 API
IUCN returns: "Maylandia zebra" (genus changed)
  ↓ Detect mismatch
Create recommendation:
  - Current: Pseudotropheus zebra
  - Suggested: Maylandia zebra
  - Reason: "IUCN accepted name differs (genus changed)"
  - Status: pending
```

## Code Changes Needed

1. **Remove broken v3 code:**
   - Delete `checkSynonym()` method (lines 337-346)
   - Remove `IUCNAPIResponse` interface (only used by v3)
   - Remove `getSpeciesById()` if it uses v3 (lines 354-362)

2. **Add new detection logic:**
   - Compare `response.taxon.genus_name` with query genus
   - Compare `response.taxon.species_name` with query species
   - If either differs, flag as potential synonym

3. **Update documentation:**
   - Note v3 deprecation
   - Explain limitations of v4 approach
   - Document what can/can't be detected

## Testing Strategy

Use known taxonomic changes to test detection:

**Fish Examples:**
- *Pseudotropheus zebra* → *Maylandia zebra* (genus change)
- *Melanochromis johannii* → *Melanochromis johanni* (spelling standardization)
- *Aulonocara baenschi* → *Aulonocara stuartgranti* (species synonymy)

**Expected Behavior:**
- ✅ Detect genus changes (e.g., Pseudotropheus → Maylandia)
- ✅ Detect species epithet changes
- ⚠️ May not detect if species entirely missing from IUCN
- ⚠️ Can't confirm it's officially a synonym vs. just different

## Future Enhancements

If more robust synonym detection is needed later:

1. Integrate with WoRMS API for marine species
2. Integrate with FishBase for freshwater fish
3. Build local synonym database from multiple sources
4. Add manual synonym mapping interface for admins

## Conclusion

While the v4 API lacks a dedicated synonym endpoint, we can still detect many taxonomic changes by comparing query names with returned accepted names. This approach is limited but functional and doesn't require additional API integrations.

The recommended approach provides value while staying within the constraints of the available API.

---

**Next Steps:**
1. Remove broken v3 code
2. Implement genus/species comparison logic
3. Proceed with migration and database schema
4. Test with known taxonomic changes
