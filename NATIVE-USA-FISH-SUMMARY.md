# Native USA Fish Species List - Summary Report

**Generated:** October 27, 2025
**Data Source:** NANFA (North American Native Fishes Association) Checklist
**Last Revised:** October 24, 2025 (by Christopher Scharpf)

## Overview

This list contains **532 native freshwater fish species** found in the United States, excluding exotic/introduced species.

## Data Sources

1. **Primary Source:** NANFA Checklist of Freshwater Fishes of North America
   - Compiled by Christopher Scharpf
   - Includes subspecies and undescribed forms
   - Revised October 24, 2025

2. **Secondary References:**
   - USGS Native Ranges of Freshwater Fishes (covers 218 species with watershed data)
   - American Fisheries Society "Common and Scientific Names of Fishes" 8th Edition (2023)
   - USGS Nonindigenous Aquatic Species Database

## Species Breakdown by Family

### Top 20 Families Represented

| Family | Species Count | Common Name |
|--------|--------------|-------------|
| Cyprinidae | 142 | Carps & Minnows |
| Percidae | 129 | Perches & Darters |
| Poeciliidae | 34 | Poeciliids/Livebearers |
| Catostomidae | 28 | Suckers |
| Cyprinodontidae | 24 | Pupfishes |
| Goodeidae | 19 | Goodeids |
| Cichlidae | 18 | Cichlids |
| Ictaluridae | 17 | North American Catfishes |
| Fundulidae | 17 | Topminnows |
| Cottidae | 17 | Sculpins |
| Atherinopsidae | 16 | New World Silversides |
| Centrarchidae | 14 | Sunfishes |
| Salmonidae | 10 | Salmonids |
| Petromyzontidae | 10 | Lampreys |
| Clupeidae | 5 | Herrings and Shads |
| Oxudercidae | 4 | Mudskipper Gobies |
| Elassomatidae | 4 | Pygmy Sunfishes |
| Gobiesocidae | 3 | Clingfishes |
| Syngnathidae | 2 | Pipefishes & Seahorses |
| Acipenseridae | 2 | Sturgeons |

### Key Statistics

- **Total Native Species:** 532
- **Total Families Represented:** ~50
- **Most Diverse Family:** Cyprinidae (minnows) with 142 species
- **Second Most Diverse:** Percidae (darters/perches) with 129 species

## Filtering Criteria

This list **excludes:**
- Exotic/introduced species (marked as EXOTIC in source data)
- Species found only in Canada or Mexico (not in USA waters)
- Marine species that don't regularly inhabit fresh water
- Species from Hawaii, Cuba, Puerto Rico (different zoogeographic realms)

This list **includes:**
- All obligatory freshwater fishes native to USA waters
- Select marine/brackish species that spawn in fresh water
- Species that commonly penetrate far inland
- Subspecies and geographic variants where documented

## Conservation Status

Many species in this list have federal or state conservation status including:
- Endangered (U.S. ESA)
- Threatened (U.S. ESA)
- Species of Concern
- Proposed Special Concern (Canada)
- State-level protections

Conservation status information is included in the CSV file where available.

## Files Generated

1. **native-usa-fish-species.csv** - Complete species list with:
   - Scientific names
   - Common names
   - Family classification
   - Conservation status (where applicable)

2. **scripts/parse-nanfa-usa-species.ts** - Parser script for extracting data from NANFA HTML

## BAP Database Comparison

The Mulm BAP database currently tracks **1,695 fish species** total. This native USA list of 532 species represents approximately **31% of the fish species in the BAP database**.

## Notable Observations

### Highly Diverse Genera

- **Cyprinella** (shiners): 20+ species
- **Etheostoma** (darters): Likely 80+ species in Percidae
- **Notropis** group (shiners): Multiple species across genera

### Regional Endemics

Many species are endemic to specific regions:
- Desert Southwest (pupfishes, desert dace)
- Appalachian region (darters, shiners, madtoms)
- Pacific Northwest (sculpins, sticklebacks, native trout)
- Gulf Coast drainages (sunfishes, darters, topminnows)

### Threatened Ecosystems

Species from these habitats face particular conservation challenges:
- Desert springs and streams (Cyprinodontidae, some Cyprinidae)
- Large river systems (Acipenseridae, Scaphirhynchus, Polyodontidae)
- Cave systems (Amblyopsidae - not fully captured in this filtered list)

## Data Quality Notes

The parsing extracted species that:
- Are not marked as EXOTIC
- Have valid scientific and common names
- Appear in USA waters

Some limitations:
- HTML entity encoding issues with special characters (é, í, etc.)
- Author citations sometimes included in common names
- Some subspecies may be counted separately

## Usage

To regenerate this list:

```bash
npm run script scripts/parse-nanfa-usa-species.ts > native-usa-fish-species.csv
```

## References

1. Scharpf, C. (2025). Checklist of Freshwater Fishes of North America. North American Native Fishes Association. https://www.nanfa.org/checklist.shtml

2. USGS Wetland and Aquatic Research Center. Native ranges of freshwater fishes of North America. https://doi.org/10.5066/P9C4N10N

3. American Fisheries Society (2023). Common and Scientific Names of Fishes from the United States, Canada, and Mexico, 8th edition.

4. USGS Nonindigenous Aquatic Species Database. https://nas.er.usgs.gov/

## Next Steps

Potential analyses or applications:
1. Cross-reference with BAP submission data to identify commonly bred native species
2. Identify gaps - native species not yet represented in BAP
3. Regional species lists for local aquarium societies
4. Conservation priority species suitable for captive breeding programs
5. Educational materials about native fish diversity
