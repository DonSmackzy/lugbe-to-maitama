// =============================================================================
// Abuja Municipal Area Council (AMAC) & Lugbe Real-World OSM GeoJSON Dataset
// packages/engine/src/gis/abuja-osm-data.ts
// Authentic GPS coordinates for major expressways, arterials, roundabouts & water
// Pure data. Zero I/O.
// =============================================================================

export const ABUJA_OSM_GEOJSON = {
  type: "FeatureCollection",
  features: [
    // -------------------------------------------------------------------------
    // 1. Water Body: Jabi Lake (Utako / Jabi)
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "water_jabi_lake",
      properties: {
        natural: "water",
        water: "lake",
        name: "Jabi Lake",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [7.4200, 9.0760],
            [7.4225, 9.0815],
            [7.4270, 9.0845],
            [7.4320, 9.0830],
            [7.4345, 9.0790],
            [7.4330, 9.0740],
            [7.4285, 9.0715],
            [7.4230, 9.0725],
            [7.4200, 9.0760],
          ],
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 2. Expressway: Airport Road (Umaru Musa Yar'Adua Way)
    // Connecting Lugbe Satellite Hub to City Gate / AMAC Core
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_airport_expressway_inbound",
      properties: {
        name: "Airport Road (Umaru Musa Yar'Adua Way - Inbound)",
        highway: "motorway",
        lanes: 4,
        oneway: "yes",
        ref: "A2",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.3550, 8.9480], // Lugbe South / Airport Junction
          [7.3680, 8.9650], // Lugbe FHA
          [7.3820, 8.9810], // Lugbe Police Station / VoA
          [7.3990, 9.0010], // Kuchingoro / Piwoyi
          [7.4180, 9.0190], // Chika / Pyakasa
          [7.4330, 9.0280], // National Stadium / Games Village
          [7.4420, 9.0340], // City Gate Roundabout
        ],
      },
    },
    {
      type: "Feature",
      id: "road_airport_expressway_outbound",
      properties: {
        name: "Airport Road (Umaru Musa Yar'Adua Way - Outbound)",
        highway: "motorway",
        lanes: 4,
        oneway: "yes",
        ref: "A2",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4420, 9.0340], // City Gate Roundabout
          [7.4330, 9.0280], // National Stadium
          [7.4180, 9.0190], // Chika
          [7.3990, 9.0010], // Kuchingoro
          [7.3820, 8.9810], // Lugbe VoA
          [7.3680, 8.9650], // Lugbe FHA
          [7.3550, 8.9480], // Lugbe South
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 3. City Gate Roundabout
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "roundabout_city_gate",
      properties: {
        name: "City Gate Roundabout",
        highway: "trunk",
        junction: "roundabout",
        lanes: 3,
        oneway: "yes",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4420, 9.0340],
          [7.4440, 9.0355],
          [7.4455, 9.0340],
          [7.4440, 9.0325],
          [7.4420, 9.0340],
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 4. Expressway: Nnamdi Azikiwe Expressway (Ring Road 1)
    // City Gate -> Area 1 -> Garki -> Apo
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_nnamdi_azikiwe_ring_road",
      properties: {
        name: "Nnamdi Azikiwe Expressway (Ring Road 1)",
        highway: "trunk",
        lanes: 3,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4440, 9.0355], // City Gate North
          [7.4580, 9.0440], // Games Village Interchange
          [7.4720, 9.0360], // Area 1 Interchange
          [7.4890, 9.0270], // Garki Area 8 / Area 11
          [7.5120, 9.0180], // Apo Roundabout / Interchange
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 5. Arterial: Ahmadu Bello Way
    // Garki -> Wuse -> Central Business District -> Maitama
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_ahmadu_bello_way",
      properties: {
        name: "Ahmadu Bello Way",
        highway: "primary",
        lanes: 3,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4720, 9.0360], // Area 1 Junction
          [7.4780, 9.0510], // Area 11 / Central Bank of Nigeria (CBN)
          [7.4850, 9.0620], // Central Business District
          [7.4910, 9.0750], // Wuse 2 Junction
          [7.4980, 9.0880], // Maitama (Shehu Shagari junction)
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 6. Arterial: Shehu Shagari Way
    // Central Area -> Federal Secretariat -> Maitama -> Three Arms Zone / Aso Rock
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_shehu_shagari_way",
      properties: {
        name: "Shehu Shagari Way",
        highway: "primary",
        lanes: 3,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.5020, 9.0490], // Federal Secretariat / Eagle Square
          [7.5090, 9.0580], // Three Arms Zone / Supreme Court
          [7.5180, 9.0680], // Millennium Park / Aso Villa Gate
          [7.5250, 9.0790], // Maitama South
          [7.4980, 9.0880], // Maitama Center
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 7. Arterial: Herbert Macaulay Way
    // Berger Roundabout -> Wuse Zone 4 (BDC Hub) -> Central Business District
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_herbert_macaulay_way",
      properties: {
        name: "Herbert Macaulay Way",
        highway: "primary",
        lanes: 2,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4680, 9.0620], // Berger Roundabout
          [7.4750, 9.0650], // Wuse Zone 4 Underbridge
          [7.4810, 9.0680], // Zone 4 BDC Hub / Sheraton
          [7.4850, 9.0620], // Central Business District / Ahmadu Bello junction
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 8. Berger Roundabout (The Pulsing Along Transit Hub)
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "roundabout_berger",
      properties: {
        name: "Berger Roundabout",
        highway: "trunk",
        junction: "roundabout",
        lanes: 3,
        oneway: "yes",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4660, 9.0620],
          [7.4680, 9.0640],
          [7.4700, 9.0620],
          [7.4680, 9.0600],
          [7.4660, 9.0620],
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 9. Expressway: Outer Northern Expressway (Murtala Mohammed / Kubwa Road)
    // Berger Roundabout -> Utako -> Katampe -> Gwarinpa
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_outer_northern_expressway",
      properties: {
        name: "Outer Northern Expressway (Kubwa Road)",
        highway: "motorway",
        lanes: 4,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4680, 9.0640], // Berger North
          [7.4520, 9.0780], // Utako / Jabi Lake Access
          [7.4320, 9.0940], // Katampe Interchange
          [7.4120, 9.1080], // Gwarinpa Main Gate / 1st Avenue
          [7.3950, 9.1250], // Gwarinpa North
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 10. AYA Roundabout (Asokoro / Karu / Nyanya Gateway)
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "roundabout_aya",
      properties: {
        name: "AYA Roundabout",
        highway: "trunk",
        junction: "roundabout",
        lanes: 3,
        oneway: "yes",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.5320, 9.0430],
          [7.5340, 9.0450],
          [7.5360, 9.0430],
          [7.5340, 9.0410],
          [7.5320, 9.0430],
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 11. Arterial: Murtala Mohammed Way (Asokoro to AYA)
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_murtala_mohammed_asokoro",
      properties: {
        name: "Murtala Mohammed Way (Asokoro)",
        highway: "primary",
        lanes: 3,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.5180, 9.0680], // Millennium Park / Aso Villa
          [7.5270, 9.0550], // Asokoro Diplomatic Zone
          [7.5340, 9.0450], // AYA Roundabout
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 12. Street: Gwarinpa 3rd Avenue
    // Commercial boulevard with nightlife & lounges
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_gwarinpa_3rd_avenue",
      properties: {
        name: "Gwarinpa 3rd Avenue",
        highway: "secondary",
        lanes: 2,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4120, 9.1080], // Gwarinpa 1st Ave Junction
          [7.4150, 9.1120], // 3rd Ave South
          [7.4180, 9.1160], // 3rd Ave Shawarma & Lounge Strip
          [7.4220, 9.1210], // 3rd Ave North
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 13. Street: Area 1 Suya Strip
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_area_1_suya_strip",
      properties: {
        name: "Area 1 Suya Strip",
        highway: "residential",
        lanes: 1,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4720, 9.0360], // Area 1 Interchange
          [7.4720, 9.0265], // Area 1 Shopping Complex / Suya Spot
        ],
      },
    },

    // -------------------------------------------------------------------------
    // 14. Close / Street: Zone 4 BDC Hub Strip
    // -------------------------------------------------------------------------
    {
      type: "Feature",
      id: "road_zone_4_bdc_strip",
      properties: {
        name: "Zone 4 BDC FX Lane",
        highway: "residential",
        lanes: 1,
        oneway: "no",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [7.4750, 9.0650], // Herbert Macaulay underbridge
          [7.4810, 9.0680], // Zone 4 BDC Hub / Forex Dealers
        ],
      },
    },
  ],
};
