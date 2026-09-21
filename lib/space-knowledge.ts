// Comprehensive Space & Astrophysics Grounded Knowledge Engine
// Provides high-accuracy offline reference data, verified equations, mathematical calculations, and domain facts.

export interface SpaceConstant {
  symbol: string
  name: string
  value: number
  unit: string
  latex: string
}

export const SPACE_CONSTANTS: Record<string, SpaceConstant> = {
  G: { symbol: 'G', name: 'Newtonian Gravitational Constant', value: 6.6743e-11, unit: 'm^3 kg^-1 s^-2', latex: '6.67430 \\times 10^{-11}\\text{ m}^3/(\\text{kg}\\cdot\\text{s}^2)' },
  c: { symbol: 'c', name: 'Speed of Light in Vacuum', value: 299792458, unit: 'm/s', latex: '2.99792458 \\times 10^8\\text{ m/s}' },
  h: { symbol: 'h', name: 'Planck Constant', value: 6.62607015e-34, unit: 'J s', latex: '6.62607 \\times 10^{-34}\\text{ J}\\cdot\\text{s}' },
  hbar: { symbol: 'ħ', name: 'Reduced Planck Constant', value: 1.054571817e-34, unit: 'J s', latex: '1.05457 \\times 10^{-34}\\text{ J}\\cdot\\text{s}' },
  kB: { symbol: 'k_B', name: 'Boltzmann Constant', value: 1.380649e-23, unit: 'J/K', latex: '1.38065 \\times 10^{-23}\\text{ J/K}' },
  sigma: { symbol: 'σ', name: 'Stefan-Boltzmann Constant', value: 5.670374419e-8, unit: 'W m^-2 K^-4', latex: '5.67037 \\times 10^{-8}\\text{ W}/(\\text{m}^2\\cdot\\text{K}^4)' },
  AU: { symbol: 'AU', name: 'Astronomical Unit', value: 1.495978707e11, unit: 'm', latex: '1.49598 \\times 10^{11}\\text{ m} \\approx 149.6\\text{ million km}' },
  ly: { symbol: 'ly', name: 'Light Year', value: 9.460730472e15, unit: 'm', latex: '9.46073 \\times 10^{15}\\text{ m} \\approx 9.46\\text{ trillion km}' },
  pc: { symbol: 'pc', name: 'Parsec', value: 3.085677581e16, unit: 'm', latex: '3.08568 \\times 10^{16}\\text{ m} \\approx 3.26\\text{ ly}' },
  M_earth: { symbol: 'M_⊕', name: 'Earth Mass', value: 5.9722e24, unit: 'kg', latex: '5.9722 \\times 10^{24}\\text{ kg}' },
  R_earth: { symbol: 'R_⊕', name: 'Earth Mean Radius', value: 6.371e6, unit: 'm', latex: '6.371 \\times 10^6\\text{ m} = 6,371\\text{ km}' },
  mu_earth: { symbol: 'μ_⊕', name: 'Earth Gravitational Parameter (GM)', value: 3.986004418e14, unit: 'm^3/s^2', latex: '3.986004418 \\times 10^{14}\\text{ m}^3/\\text{s}^2' },
  M_sun: { symbol: 'M_☉', name: 'Solar Mass', value: 1.98847e30, unit: 'kg', latex: '1.98847 \\times 10^{30}\\text{ kg}' },
  R_sun: { symbol: 'R_☉', name: 'Solar Radius', value: 6.957e8, unit: 'm', latex: '6.957 \\times 10^8\\text{ m} = 695,700\\text{ km}' },
  L_sun: { symbol: 'L_☉', name: 'Solar Luminosity', value: 3.828e26, unit: 'W', latex: '3.828 \\times 10^{26}\\text{ W}' },
  M_moon: { symbol: 'M_moon', name: 'Moon Mass', value: 7.342e22, unit: 'kg', latex: '7.342 \\times 10^{22}\\text{ kg}' },
  R_moon: { symbol: 'R_moon', name: 'Moon Radius', value: 1.7374e6, unit: 'm', latex: '1.7374 \\times 10^6\\text{ m} = 1,737.4\\text{ km}' },
  mu_moon: { symbol: 'μ_moon', name: 'Moon Gravitational Parameter', value: 4.9048695e12, unit: 'm^3/s^2', latex: '4.90487 \\times 10^{12}\\text{ m}^3/\\text{s}^2' },
  M_mars: { symbol: 'M_mars', name: 'Mars Mass', value: 6.4171e23, unit: 'kg', latex: '6.4171 \\times 10^{23}\\text{ kg}' },
  R_mars: { symbol: 'R_mars', name: 'Mars Mean Radius', value: 3.3895e6, unit: 'm', latex: '3.3895 \\times 10^6\\text{ m} = 3,389.5\\text{ km}' },
  mu_mars: { symbol: 'μ_mars', name: 'Mars Gravitational Parameter', value: 4.282837e13, unit: 'm^3/s^2', latex: '4.28284 \\times 10^{13}\\text{ m}^3/\\text{s}^2' },
  M_jupiter: { symbol: 'M_jup', name: 'Jupiter Mass', value: 1.8982e27, unit: 'kg', latex: '1.8982 \\times 10^{27}\\text{ kg}' },
  R_jupiter: { symbol: 'R_jup', name: 'Jupiter Mean Radius', value: 6.9911e7, unit: 'm', latex: '6.9911 \\times 10^7\\text{ m} = 69,911\\text{ km}' },
  mu_jupiter: { symbol: 'μ_jup', name: 'Jupiter Gravitational Parameter', value: 1.26686534e17, unit: 'm^3/s^2', latex: '1.26687 \\times 10^{17}\\text{ m}^3/\\text{s}^2' },
}

export interface CelestialBodyData {
  name: string
  massKg: number
  radiusM: number
  mu: number
  surfaceGravity: number
  escapeVelocityKmS: number
  orbitalPeriodDays?: number
  semiMajorAxisAU?: number
  surfaceTempK: string
  atmosphere: string
  highlights: string[]
}

export const CELESTIAL_BODIES: Record<string, CelestialBodyData> = {
  earth: {
    name: 'Earth',
    massKg: 5.9722e24,
    radiusM: 6.371e6,
    mu: 3.986004418e14,
    surfaceGravity: 9.807,
    escapeVelocityKmS: 11.186,
    orbitalPeriodDays: 365.256,
    semiMajorAxisAU: 1.0,
    surfaceTempK: '288 K (mean: 15°C)',
    atmosphere: '78.08% N2, 20.95% O2, 0.93% Ar, 0.04% CO2',
    highlights: ['Active global plate tectonics and strong dipolar dynamo magnetic field', 'Abundant surface liquid water covering ~71% of surface area', 'Only confirmed world currently harboring active biosphere'],
  },
  mars: {
    name: 'Mars',
    massKg: 6.4171e23,
    radiusM: 3.3895e6,
    mu: 4.282837e13,
    surfaceGravity: 3.72,
    escapeVelocityKmS: 5.027,
    orbitalPeriodDays: 686.98,
    semiMajorAxisAU: 1.524,
    surfaceTempK: '210 K (-63°C average, range 140 K to 300 K)',
    atmosphere: '95.32% CO2, 2.6% N2, 1.9% Ar, 0.16% O2 (surface pressure ~6.1 mbar)',
    highlights: ['Features Olympus Mons (tallest planetary volcano: 21.9 km) and Valles Marineris (canyon system > 4,000 km long)', 'Subsurface water ice permafrost confirmed globally by Mars Odyssey, Phoenix, and Mars Express radar', 'Sedimentary delta deposits in Jezero Crater (explored by Perseverance rover) confirm past persistent lacustrine activity'],
  },
  europa: {
    name: 'Europa (Moon of Jupiter)',
    massKg: 4.7998e22,
    radiusM: 1.5608e6,
    mu: 3.203e12,
    surfaceGravity: 1.315,
    escapeVelocityKmS: 2.025,
    orbitalPeriodDays: 3.551,
    surfaceTempK: '50 K to 125 K (-223°C to -148°C)',
    atmosphere: 'Tenuous molecular oxygen (O2) created by radiolysis of surface water ice',
    highlights: ['Smooth water-ice crust with intersecting lineae, ridges, and chaos terrain', 'Subsurface liquid saltwater ocean containing 2-3x the volume of all Earth oceans combined (~60-150 km deep)', 'Tidally heated by 4:2:1 Laplace orbital resonance with Io and Ganymede; prime astrobiology candidate for NASA Europa Clipper and ESA JUICE'],
  },
  titan: {
    name: 'Titan (Moon of Saturn)',
    massKg: 1.3452e23,
    radiusM: 2.5747e6,
    mu: 8.978e12,
    surfaceGravity: 1.352,
    escapeVelocityKmS: 2.639,
    orbitalPeriodDays: 15.945,
    surfaceTempK: '93.7 K (-179.5°C)',
    atmosphere: '94.2% N2, 5.65% CH4, trace hydrocarbons (surface pressure 1.45 bar - 50% higher than Earth)',
    highlights: ['Only moon with a dense atmosphere and active hydrological liquid cycle (methane/ethane rain, rivers, Kraken Mare lakes)', 'Organic dunes made of complex tholins created by UV photolysis of methane in the upper atmosphere', 'Decoupled subsurface liquid water-ammonia ocean below outer ice shell; target of NASA Dragonfly rotorcraft mission'],
  },
  enceladus: {
    name: 'Enceladus (Moon of Saturn)',
    massKg: 1.08e20,
    radiusM: 2.521e5,
    mu: 7.21e9,
    surfaceGravity: 0.113,
    escapeVelocityKmS: 0.239,
    orbitalPeriodDays: 1.37,
    surfaceTempK: '75 K (-198°C average)',
    atmosphere: 'Transient plume gas (91% H2O, 4% N2, 3.2% CO2, 1.7% CH4)',
    highlights: ['Active cryovolcanic geysers erupting from south polar "tiger stripe" fractures into Saturn E-ring', 'Cassini INMS mass spectrometry detected molecular hydrogen (H2) and complex organic macromolecules, confirming active hydrothermal venting at the ocean-rock core interface', 'Subsurface global liquid ocean with alkaline pH (9-11) and serpentinization chemistry'],
  },
  moon: {
    name: 'Moon (Earth Moon)',
    massKg: 7.342e22,
    radiusM: 1.7374e6,
    mu: 4.90487e12,
    surfaceGravity: 1.622,
    escapeVelocityKmS: 2.38,
    orbitalPeriodDays: 27.322,
    surfaceTempK: '100 K to 390 K (-173°C to 117°C)',
    atmosphere: 'Extremely thin exosphere (He, Ne, Ar, Na, K)',
    highlights: ['Permanently shadowed craters at lunar south pole (Shackleton crater) harbor estimated hundreds of millions of tons of water ice', 'Formed ~4.51 billion years ago by giant impact hypothesis (Theia collision with proto-Earth)', 'Target of NASA Artemis human exploration and Lunar Gateway orbital station'],
  },
  sun: {
    name: 'The Sun (Sol)',
    massKg: 1.98847e30,
    radiusM: 6.957e8,
    mu: 1.3271244e20,
    surfaceGravity: 274.0,
    escapeVelocityKmS: 617.5,
    surfaceTempK: '5,778 K (Photosphere), 15.7 million K (Core), 1-3 million K (Corona)',
    atmosphere: '73.46% Hydrogen, 24.85% Helium, 0.77% Oxygen, 0.29% Carbon (by mass)',
    highlights: ['G2V main-sequence yellow dwarf star accounting for 99.86% of the Solar System total mass', 'Generates 3.828 × 10^26 W through core proton-proton chain nuclear fusion, converting 600 million tons of H to He per second', 'Solar magnetic 11-year sunspot cycle driving coronal mass ejections (CMEs) and solar wind into heliosphere'],
  },
  jupiter: {
    name: 'Jupiter',
    massKg: 1.8982e27,
    radiusM: 6.9911e7,
    mu: 1.26686534e17,
    surfaceGravity: 24.79,
    escapeVelocityKmS: 59.5,
    orbitalPeriodDays: 4332.59,
    semiMajorAxisAU: 5.204,
    surfaceTempK: '165 K (at 1 bar level)',
    atmosphere: '89% H2, 10% He, 0.3% CH4, 0.026% NH3',
    highlights: ['Largest planet in the Solar System (2.5 times the combined mass of all other planets combined)', 'Great Red Spot anticyclonic storm larger than Earth, persistent for over 350 years', 'Intense radiation belts and colossal magnetosphere extending up to 7 million km toward the Sun'],
  },
}

// Built-in verified offline space corpus for high-accuracy local retrieval
export const OFFLINE_SPACE_CORPUS: { title: string; category: string; content: string }[] = [
  {
    title: 'Escape Velocity and Gravitational Mechanics',
    category: 'Orbital Mechanics',
    content: `Escape velocity (v_esc) is the minimum theoretical speed required for an unpropelled ballistic body to escape from the gravitational influence of a primary massive body to infinite distance with zero residual kinetic energy.
Governing Derivation by Conservation of Mechanical Energy:
Total energy E = K + U = 0 at infinity.
At distance r: 1/2 m v_esc^2 - (G M m)/r = 0 => 1/2 v_esc^2 = (G M)/r => v_esc = sqrt((2 G M)/r) = sqrt((2 mu)/r).
Key Numerical Values:
- Earth surface (r = 6,371 km, mu = 3.986004418e14 m^3/s^2): v_esc = sqrt((2 * 3.986004418e14) / 6.371e6) = 11,186 m/s = 11.19 km/s.
- Moon surface (r = 1,737.4 km, mu = 4.90487e12 m^3/s^2): v_esc = 2,380 m/s = 2.38 km/s.
- Mars surface (r = 3,389.5 km, mu = 4.28284e13 m^3/s^2): v_esc = 5,027 m/s = 5.03 km/s.
- Sun surface (r = 695,700 km, mu = 1.32712e20 m^3/s^2): v_esc = 617.5 km/s.
Circular Orbit Velocity: v_circ = sqrt(mu / r) = v_esc / sqrt(2). For low Earth orbit (LEO at 400 km, r = 6,771 km), v_circ = 7.67 km/s, v_esc = 10.85 km/s.`,
  },
  {
    title: 'Orbital Transfers, Hohmann Delta-V and Keplerian Mechanics',
    category: 'Orbital Mechanics',
    content: `Hohmann Transfer Orbit is the most fuel-efficient two-impulse orbital maneuver between two coplanar, circular orbits of radii r1 and r2.
Semi-major axis of transfer ellipse: a_trans = (r1 + r2) / 2.
First burn Delta-v1 at periapsis: Delta-v1 = sqrt(mu / r1) * (sqrt((2 * r2) / (r1 + r2)) - 1).
Second burn Delta-v2 at apoapsis: Delta-v2 = sqrt(mu / r2) * (1 - sqrt((2 * r1) / (r1 + r2))).
Total Delta-v = |Delta-v1| + |Delta-v2|.
Transfer duration: t_trans = pi * sqrt(a_trans^3 / mu) = T_trans / 2.
Kepler's Third Law: Orbital period T = 2 * pi * sqrt(a^3 / mu). For Earth geostationary orbit (GEO, r = 42,164 km, altitude 35,786 km), T = 86,164 seconds (1 sidereal day), circular velocity v_geo = 3.075 km/s.
Tsiolkovsky Rocket Equation: Delta-v = I_sp * g0 * ln(m0 / mf), where I_sp is specific impulse, g0 = 9.80665 m/s^2, m0 is initial wet mass, mf is final dry mass.`,
  },
  {
    title: 'Black Holes, Event Horizons and Gravitational Physics',
    category: 'Astrophysics & Relativity',
    content: `A black hole is an extreme astrophysical region of spacetime where gravitational curvature becomes so intense that no particle or electromagnetic radiation (including light) can escape beyond the event horizon.
Key Equations and Parameters:
1. Schwarzschild Radius (Non-rotating event horizon): r_s = (2 * G * M) / c^2 = 2.953 km * (M / M_sun).
- For a 10 Solar Mass stellar black hole: r_s = 29.53 km.
- For Sagittarius A* (Supermassive black hole at Milky Way center, M = 4.154e6 M_sun): r_s = 1.23e7 km (0.082 AU).
- For M87* (M = 6.5e9 M_sun): r_s = 1.92e10 km (128 AU).
2. Photon Sphere: r_ph = 1.5 * r_s = (3 * G * M) / c^2.
3. Innermost Stable Circular Orbit (ISCO): For Schwarzschild black hole, r_isco = 3 * r_s = 6 * G * M / c^2.
4. Hawking Radiation Temperature: T_H = (hbar * c^3) / (8 * pi * G * M * k_B).
Stellar Collapse Pathway: Stars with initial zero-age main sequence mass > 20-25 M_sun exhaust hydrogen, helium, carbon, neon, oxygen, and silicon core burning until an iron-56 core forms. When iron core exceeds Chandrasekhar limit (~1.44 M_sun), electron degeneracy pressure collapses into neutron star or directly collapses past TOV limit into a stellar-mass black hole.`,
  },
  {
    title: 'James Webb Space Telescope (JWST) Architecture & Science',
    category: 'Space Telescopes & Missions',
    content: `The James Webb Space Telescope (JWST) is an infrared space observatory launched on December 25, 2021, operating around the Sun-Earth Lagrange Point 2 (L2), approximately 1.5 million kilometers from Earth on the anti-sunward side.
Key Engineering & Scientific Specifications:
- Primary Mirror: 6.5-meter diameter composed of 18 gold-coated beryllium hexagonal segments, collecting area 25.4 m^2 (vs Hubble 2.4m, 4.5 m^2).
- Thermal Protection: 5-layer Kapton polyimide sunshield (21.2m x 14.2m) creating a ~300 K temperature differential (Sun-facing side +85°C / 358 K; instrument side -233°C / 40 K).
- Science Instruments:
  1. NIRCam (Near-Infrared Camera): 0.6 - 5.0 micrometers; deep-field galaxy imaging, exoplanet coronagraphy.
  2. NIRSpec (Near-Infrared Spectrograph): 0.6 - 5.3 micrometers with microshutter array for simultaneous multi-object spectroscopy of 100+ galaxies.
  3. MIRI (Mid-Infrared Instrument): 4.9 - 28.8 micrometers; actively cooled down to 6.7 K (-266°C) using a closed-cycle helium loop cryocooler to eliminate instrument thermal noise.
  4. NIRISS / FGS (Near-Infrared Imager & Slitless Spectrograph): Fine Guidance Sensor and high-contrast transit spectroscopy.
Scientific Breakthroughs: Observed early high-redshift galaxies (e.g. JADES-GS-z14-0 at z = 14.32, formed ~290 million years post Big Bang); detected atmospheric CO2, CH4, and SO2 on exoplanets such as WASP-39b and WASP-107b.`,
  },
  {
    title: 'Comparative Astrobiology: Mars, Europa, Titan, and Enceladus',
    category: 'Planetary Science & Astrobiology',
    content: `Comparative analysis of prime targets in the search for extraterrestrial life:
1. Europa (Moon of Jupiter):
- Environment: 15-25 km thick water-ice shell overlying a 60-150 km deep liquid saltwater ocean (contains 2-3x Earth's ocean volume).
- Energy: Tidal dissipation heating from 4:2:1 orbital resonance with Io and Ganymede; potential hydrothermal vents at ocean-silicate mantle floor.
- Radiolytic oxidants (O2, H2O2) produced on surface by Jovian magnetospheric particle irradiation.
2. Titan (Moon of Saturn):
- Environment: Dense nitrogen atmosphere (1.45 bar), cold surface (94 K) with liquid methane and ethane lakes/seas (Kraken Mare, Ligeia Mare).
- Organic Chemistry: UV photolysis generates complex hydrocarbon aerosols and tholins; decoupled subsurface liquid water-ammonia ocean below ice crust.
- Astrobiological potential: Exotic non-water methane-based biochemistry (azotosomes) on surface + prebiotic aqueous life in subsurface ocean.
3. Enceladus (Moon of Saturn):
- Environment: Cryovolcanic plumes erupting from South Polar Tiger Stripes directly into space.
- Verified Composition (Cassini INMS): 96-99% H2O, 0.4-1.4% H2, 0.3-0.8% CO2, 0.1-0.3% CH4, complex macromolecules, phosphorus, and silica nanoparticles (confirming >90°C alkaline hydrothermal systems).
4. Mars:
- Past habitability: Early Noachian-Hesperian epoch (>3.5 Ga) featured surface liquid lakes, rivers, magnetic dynamo, and thicker atmosphere.
- Current habitability: Subsurface permafrost, brines, and protected deep crustal aquifers shielded from solar UV and cosmic rays.`,
  },
  {
    title: 'Solar System Architecture and Planetary Classification',
    category: 'Planetary Science',
    content: `The Solar System formed 4.568 billion years ago from gravitational collapse of a giant interstellar molecular cloud.
Structure from Central Star outward:
1. The Sun: G2V main-sequence star, accounts for 99.86% of total system mass.
2. Terrestrial Planets: Mercury (0.39 AU), Venus (0.72 AU), Earth (1.00 AU), Mars (1.52 AU) - dense silicate rock, metallic cores.
3. Asteroid Belt (2.2 - 3.2 AU): Remnants of planetesimals prevented from accreting by Jupiter gravity; contains dwarf planet Ceres.
4. Gas Giants: Jupiter (5.20 AU, 318 M_earth), Saturn (9.58 AU, 95 M_earth) - predominantly H and He envelopes.
5. Ice Giants: Uranus (19.22 AU, 14.5 M_earth), Neptune (30.05 AU, 17.1 M_earth) - mantle of volatile water, ammonia, methane ices.
6. Kuiper Belt (30 - 50 AU): Trans-Neptunian disc of icy bodies, home to Pluto, Eris, Haumea, Makemake, and Arrokoth.
7. Oort Cloud (2,000 - 100,000 AU): Spherical reservoir of trillions of icy planetesimals, source of long-period comets.`,
  },
  {
    title: 'General Relativity, Gravitational Waves and Spacetime Curvature',
    category: 'Relativity & Cosmology',
    content: `Einstein's General Theory of Relativity (1915) describes gravity not as a Newtonian force, but as the curvature of 4D spacetime caused by energy-momentum.
Einstein Field Equations: G_{mu nu} + Lambda * g_{mu nu} = (8 * pi * G / c^4) * T_{mu nu}.
Key Predictions & Validations:
1. Gravitational Time Dilation: Clocks in deeper gravitational potential tick slower: Delta t_f = Delta t_0 * sqrt(1 - 2*G*M / (r * c^2)).
2. Gravitational Deflection of Light: Light passing mass M at impact parameter b bends by angle theta = 4*G*M / (b * c^2) (confirmed by Eddington 1919 solar eclipse).
3. Gravitational Redshift: z = 1 / sqrt(1 - 2*G*M / (r * c^2)) - 1.
4. Gravitational Waves: Ripples in spacetime metric propagating at speed of light c, quadrupole radiation emitted by accelerating asymmetric masses (e.g. binary black hole merger GW150914 detected by LIGO/Virgo).`,
  },
  {
    title: 'Cosmology, Big Bang and Cosmic Expansion',
    category: 'Cosmology',
    content: `Standard Lambda-CDM cosmological model of the Universe:
1. Age of the Universe: 13.787 +/- 0.020 billion years (Planck satellite CMB measurement).
2. Energy Budget: ~68.3% Dark Energy (Cosmological Constant Lambda), ~26.8% Cold Dark Matter (CDM), ~4.9% Baryonic matter (atoms/stars/gas).
3. Hubble-Lemaitre Law: Recessional velocity v = H_0 * d, where H_0 is Hubble constant (~67.4 - 73.0 km/s/Mpc).
4. Cosmic Microwave Background (CMB): Thermal blackbody radiation remnant from recombination epoch (z ~ 1100, 380,000 years after Big Bang) at temperature T = 2.7255 K.
5. Cosmological Redshift: 1 + z = a_0 / a(t) = lambda_obs / lambda_emit.`,
  },
]
