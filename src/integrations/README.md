# External Integrations

This directory contains clients for external APIs and services integrated into the BAP platform.

## IUCN Red List API Integration

**File:** `iucn.ts`
**Purpose:** Fetch conservation status data from the IUCN Red List API
**Documentation:** [Wiki - IUCN Red List Integration](https://github.com/jra3/mulm/wiki/IUCN-Red-List-Integration)

### Quick Start

```typescript
import { getIUCNClient } from "@/integrations/iucn";

// Get singleton client instance
const client = getIUCNClient();

// Look up species by scientific name
const species = await client.getSpeciesByName("Panthera tigris");

if (species) {
  console.log(`Conservation status: ${species.category}`);
  console.log(`Population trend: ${species.population_trend}`);
  console.log(`IUCN ID: ${species.taxonid}`);
}
```

### API Client Methods

#### `getSpeciesByName(scientificName: string)`

Look up a species by full scientific name (binomial).

```typescript
const tiger = await client.getSpeciesByName("Panthera tigris");
// Returns IUCNSpeciesResult or null if not found
```

#### `getSpecies(genus: string, species: string)`

Look up a species by genus and species epithet.

```typescript
const tiger = await client.getSpecies("Panthera", "tigris");
// Convenience wrapper for getSpeciesByName
```

#### `checkSynonym(scientificName: string)`

Check if a name is a synonym and get the accepted name.

```typescript
const accepted = await client.checkSynonym("Betta splendens");
// Returns IUCNSpeciesResult for accepted name or null
```

#### `getSpeciesById(taxonId: number)`

Get species data by IUCN taxon ID.

```typescript
const species = await client.getSpeciesById(15951);
// Returns IUCNSpeciesResult or null
```

#### `testConnection()`

Test API connectivity and token validity.

```typescript
const isConnected = await client.testConnection();
// Returns true if API is accessible
```

### Response Types

#### IUCNSpeciesResult

```typescript
interface IUCNSpeciesResult {
  taxonid: number;           // IUCN taxon identifier
  scientific_name: string;   // Scientific name
  kingdom: string;           // Kingdom
  phylum: string;            // Phylum
  class: string;             // Class
  order: string;             // Order
  family: string;            // Family
  genus: string;             // Genus
  main_common_name?: string; // Primary common name
  authority?: string;        // Taxonomic authority
  published_year?: number;   // Year of assessment
  assessment_date?: string;  // Assessment date
  category: IUCNCategory;    // Conservation status
  criteria?: string;         // IUCN criteria
  population_trend?: PopulationTrend; // Trend
  marine_system?: boolean;
  freshwater_system?: boolean;
  terrestrial_system?: boolean;
}
```

#### IUCN Categories

```typescript
type IUCNCategory = "EX" | "EW" | "CR" | "EN" | "VU" | "NT" | "LC" | "DD" | "NE";
```

| Code | Category | Meaning |
|------|----------|---------|
| EX | Extinct | No living individuals |
| EW | Extinct in Wild | Only in captivity |
| CR | Critically Endangered | Extreme risk |
| EN | Endangered | High risk |
| VU | Vulnerable | At risk |
| NT | Near Threatened | Close to threatened |
| LC | Least Concern | Low risk |
| DD | Data Deficient | Insufficient data |
| NE | Not Evaluated | Not assessed |

#### Population Trends

```typescript
type PopulationTrend = "Increasing" | "Decreasing" | "Stable" | "Unknown";
```

### Rate Limiting

The client automatically enforces IUCN's 2-second rate limit between API calls:

```typescript
// First call executes immediately
await client.getSpeciesByName("Species A");

// Second call waits 2 seconds automatically
await client.getSpeciesByName("Species B");
```

**Configuration:**
```json
{
  "iucn": {
    "rateLimitMs": 2000  // 2 second delay (required by IUCN)
  }
}
```

### Error Handling

The client throws `IUCNAPIError` for all API failures:

```typescript
try {
  const species = await client.getSpeciesByName("Invalid Name");
} catch (error) {
  if (error instanceof IUCNAPIError) {
    console.error(`IUCN API Error (${error.statusCode}): ${error.message}`);
  }
}
```

**Common Error Codes:**
- `401` - Invalid or expired API token
- `404` - Species not found (returns null instead of throwing)
- `429` - Rate limit exceeded (auto-retries with exponential backoff)
- `timeout` - Request exceeded timeout (default: 10 seconds)

### Retry Logic

Failed requests automatically retry with exponential backoff:

1. First retry: Wait 2 seconds
2. Second retry: Wait 4 seconds
3. Third retry: Wait 8 seconds
4. After max retries: Throw error

**Configuration:**
```json
{
  "iucn": {
    "maxRetries": 3,
    "timeoutMs": 10000
  }
}
```

### Singleton Pattern

The client uses a singleton pattern to maintain rate limiting state:

```typescript
// Get the same instance everywhere
const client1 = getIUCNClient();
const client2 = getIUCNClient(); // Same instance

// For testing: reset singleton
import { resetIUCNClient } from "@/integrations/iucn";
resetIUCNClient();
```

### Configuration

Add IUCN configuration to `src/config.json`:

```json
{
  "iucn": {
    "apiToken": "YOUR_TOKEN_HERE",
    "baseUrl": "https://apiv3.iucnredlist.org/api/v3",
    "rateLimitMs": 2000,
    "enableSync": true,
    "maxRetries": 3,
    "timeoutMs": 10000
  }
}
```

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiToken` | string | required | IUCN API token |
| `baseUrl` | string | `https://apiv3.iucnredlist.org/api/v3` | API base URL |
| `rateLimitMs` | number | `2000` | Delay between requests (ms) |
| `enableSync` | boolean | `true` | Enable IUCN integration |
| `maxRetries` | number | `3` | Max retry attempts |
| `timeoutMs` | number | `10000` | Request timeout (ms) |

### Obtaining an API Token

1. Visit: https://apiv3.iucnredlist.org/api/v3/token
2. Fill out registration form
3. Agree to Terms of Use (non-commercial only)
4. Receive token via email
5. Add to `config.json`

### Usage Examples

#### Basic Species Lookup

```typescript
import { getIUCNClient } from "@/integrations/iucn";

const client = getIUCNClient();
const data = await client.getSpecies("Corydoras", "paleatus");

if (data) {
  console.log(`${data.scientific_name} is ${data.category}`);
  // Output: "Corydoras paleatus is VU"
}
```

#### Batch Processing with Rate Limiting

```typescript
const speciesList = ["Panthera tigris", "Gorilla gorilla", "Orcinus orca"];

for (const name of speciesList) {
  // Client automatically waits 2 seconds between calls
  const data = await client.getSpeciesByName(name);
  console.log(`${name}: ${data?.category ?? "Not Found"}`);
}
```

#### Error Handling

```typescript
try {
  const data = await client.getSpeciesByName("Betta splendens");

  if (!data) {
    console.log("Species not in IUCN database");
  } else {
    console.log(`Status: ${data.category}`);
  }
} catch (error) {
  if (error instanceof IUCNAPIError) {
    if (error.statusCode === 401) {
      console.error("Invalid API token - check configuration");
    } else if (error.statusCode === 429) {
      console.error("Rate limited - slow down requests");
    } else {
      console.error(`API error: ${error.message}`);
    }
  }
}
```

### Testing

The client can be tested without making real API calls:

```typescript
import { IUCNClient } from "@/integrations/iucn";

// Create client with custom config for testing
const testClient = new IUCNClient({
  apiToken: "test-token",
  baseUrl: "http://localhost:3000/mock-iucn",
  rateLimitMs: 100, // Faster for tests
  maxRetries: 1,
});
```

### Logging

The client uses the application logger to track API activity:

```typescript
import { logger } from "@/utils/logger";

// Info: Rate limiting delays
logger.info("Rate limiting: waiting 2000ms");

// Info: API requests
logger.info("IUCN API request: /species/Panthera%20tigris");

// Warn: Retries
logger.warn("IUCN API rate limited. Retrying in 4000ms (attempt 2)");

// Error: Failures
logger.error("IUCN API connection test failed", error);
```

### Related Files

- **API Client:** `src/integrations/iucn.ts`
- **Database Functions:** `src/db/iucn.ts` (to be created)
- **Sync Script:** `scripts/sync-iucn-data.ts` (to be created)
- **CSV Import:** `scripts/import-cares-iucn-data.ts`
- **Migration:** `db/migrations/036-add-iucn-integration.sql`
- **Types:** `src/config.d.ts` (Config interface)

### References

- [IUCN Red List Homepage](https://www.iucnredlist.org)
- [API Documentation](https://api.iucnredlist.org/api-docs/)
- [Terms of Use](https://www.iucnredlist.org/terms/terms-of-use)
- [Issue #179](https://github.com/jra3/mulm/issues/179) - Implementation tracking
- [Wiki Documentation](https://github.com/jra3/mulm/wiki/IUCN-Red-List-Integration)
