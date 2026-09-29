// Random events, city happenings and disasters. Owned by the "events" agent.
// Every entry is an `EventDef` (frozen contract) extended with the data the
// EventSystem needs to run it: modifiers while active, where it happens, the
// weather it forces, how disaster-response buildings mitigate it, and the
// notification copy. Ids are what `/summon <id>` accepts.
import type { EventDef, WeatherType } from '../core/types';
import type { EventModifiers } from '../sim/events/EventSystem';

/** where an event takes place (picked when it starts; `/summon id x y` overrides) */
export type EventPlace =
  | 'none' // city-wide, no location
  | 'city' // a random developed spot (building-weighted)
  | 'park' // a park / plaza (falls back to city hall, then the city centre)
  | 'stadium' // a stadium / arena / sports building (falls back to park)
  | 'building' // a random completed building
  | 'tall' // a tall building (lightning)
  | 'industry' // an industrial building or power plant
  | 'forest' // a forested cell (prefers near the city)
  | 'coast' // a shoreline cell next to the sea
  | 'road' // a road cell in the developed area
  | 'farm'; // farming zone (falls back to city)

/** disaster-response mitigation group */
export type Hazard = 'fire' | 'storm' | 'quake' | 'flood' | 'impact' | 'ground' | 'tsunami';

export interface EventSpec extends EventDef {
  /** modifiers applied while active (add fields are summed, mult fields multiplied) */
  mods?: Partial<EventModifiers>;
  place?: EventPlace;
  /** start notice text ({place} is replaced by a location name) */
  startText: string;
  /** end notice text (omitted = silent end) */
  endText?: string;
  /** days before the event can roll again after it ends */
  cooldown?: number;
  /** requires sea on the map */
  coastal?: boolean;
  /** weather forced for the event's duration */
  weather?: WeatherType;
  weatherIntensity?: number;
  /** mitigated by disaster-response buildings of this group */
  hazard?: Hazard;
  /** one-time money granted (+) or charged (−) at start, scaled by population/1000 */
  moneyPer1k?: number;
  /** rolls are more likely when this condition holds (evaluated by the system) */
  boostWhen?: 'highTax' | 'lowHappiness' | 'highUnemployment' | 'lowHealth' | 'highCrime' | 'hot' | 'dry' | 'storm' | 'winter' | 'farming' | 'industry' | 'educated';
  /** a special-case event not rolled randomly (New Year is triggered on the year change) */
  scripted?: boolean;
}

const good = (e: Omit<EventSpec, 'severity'>): EventSpec => ({ ...e, severity: 'good' });
const bad = (e: Omit<EventSpec, 'severity'>, sev: 'warning' | 'danger' = 'warning'): EventSpec => ({ ...e, severity: sev });
const disaster = (e: Omit<EventSpec, 'severity' | 'disaster'>): EventSpec => ({ ...e, severity: 'disaster', disaster: true });

export const EVENTS: EventSpec[] = [
  // ══ POSITIVE ══════════════════════════════════════════════════════════════
  good({
    id: 'festival', name: 'Summer Festival', icon: '🎆', yearlyChance: 0.9, minPopulation: 400, duration: 8, summonable: true,
    description: 'Music stages, food stalls and fireworks every night over the park. Citizens love it and visitors pour in.',
    seasons: ['summer'], place: 'park', cooldown: 90,
    mods: { happiness: 6, tourismMult: 1.3, demandCom: 0.06, incomeMult: 1.02 },
    startText: 'The Summer Festival opens at {place}! Fireworks light up the sky every night.', endText: 'The Summer Festival wrapped up. What a week!',
  }),
  good({
    id: 'celebrity', name: 'Celebrity Visit', icon: '🌟', yearlyChance: 0.5, minPopulation: 2_000, duration: 4, summonable: true,
    description: 'A global superstar is in town. Paparazzi, crowds and a sudden spike in tourism and shopping.',
    place: 'city', cooldown: 120, mods: { tourismMult: 1.25, happiness: 3, demandCom: 0.08 },
    startText: 'A world-famous celebrity was spotted near {place}. Crowds are gathering!', endText: 'The celebrity has left town. The selfies remain.',
  }),
  good({
    id: 'championship', name: 'Sports Championship', icon: '🏆', yearlyChance: 0.45, minPopulation: 6_000, duration: 5, summonable: true,
    description: 'The home team is in the final. Bars are packed, streets are painted in team colours.',
    place: 'stadium', cooldown: 180, mods: { happiness: 8, tourismMult: 1.2, demandCom: 0.05, trafficMult: 1.1 },
    startText: 'Championship fever! The final is played at {place} and the whole city is watching.', endText: 'Champions! The parade is over, the confetti is being swept up.',
  }),
  good({
    id: 'film_shoot', name: 'Blockbuster Film Shoot', icon: '🎬', yearlyChance: 0.45, minPopulation: 3_000, duration: 6, summonable: true,
    description: 'A Hollywood crew is filming on location. Streets are closed, but the city is about to be famous.',
    place: 'road', cooldown: 150, mods: { tourismMult: 1.15, demandCom: 0.05, trafficMult: 1.08, happiness: 2 },
    startText: 'Lights, camera, action! A blockbuster is being filmed around {place}.', endText: 'That\'s a wrap! The film crew packed up and left.',
  }),
  good({
    id: 'tech_boom', name: 'Tech Boom', icon: '💻', yearlyChance: 0.3, minPopulation: 8_000, duration: 40, summonable: true,
    description: 'Start-ups and venture capital flood in. Office space is suddenly the hottest commodity in town.',
    place: 'none', cooldown: 360, boostWhen: 'educated', mods: { demandOff: 0.35, demandCom: 0.08, incomeMult: 1.05, happiness: 1 },
    startText: 'A tech boom is under way! Companies are scrambling for office space.', endText: 'The tech boom has cooled off.',
  }),
  good({
    id: 'tourism_surge', name: 'Tourism Surge', icon: '🧳', yearlyChance: 0.5, minPopulation: 1_500, duration: 18, summonable: true,
    description: 'A glowing travel-magazine review sends visitors flocking to the city.',
    place: 'none', cooldown: 120, mods: { tourismMult: 1.5, demandCom: 0.1, trafficMult: 1.05 },
    startText: 'Your city made the cover of a travel magazine. Tourists are pouring in!', endText: 'The tourist rush is back to normal.',
  }),
  good({
    id: 'harvest_festival', name: 'Harvest Festival', icon: '🌽', yearlyChance: 0.8, minPopulation: 300, duration: 6, summonable: true,
    description: 'Farm stands, pumpkin contests and cider. The countryside comes to town.',
    seasons: ['autumn'], place: 'park', cooldown: 200, boostWhen: 'farming', mods: { happiness: 4, tourismMult: 1.1, demandInd: 0.06, demandCom: 0.04 },
    startText: 'The Harvest Festival opens at {place}. Fresh cider and pumpkins for everyone!', endText: 'The Harvest Festival is over until next year.',
  }),
  good({
    id: 'marathon', name: 'City Marathon', icon: '🏃', yearlyChance: 0.6, minPopulation: 2_500, duration: 2, summonable: true,
    description: 'Thousands of runners take over the streets. Some roads close, spirits soar.',
    seasons: ['spring', 'autumn'], place: 'road', cooldown: 150, mods: { happiness: 3, healthMult: 0.92, trafficMult: 1.2, tourismMult: 1.1 },
    startText: 'The City Marathon starts near {place}! Expect road closures.', endText: 'The marathon is over. Well run, everyone!',
  }),
  good({
    id: 'concert', name: 'Open-Air Concert', icon: '🎸', yearlyChance: 0.7, minPopulation: 1_200, duration: 3, summonable: true,
    description: 'A headline band plays a free open-air show. The whole city sings along.',
    seasons: ['spring', 'summer', 'autumn'], place: 'park', cooldown: 90, mods: { happiness: 4, tourismMult: 1.2, demandCom: 0.04, trafficMult: 1.05 },
    startText: 'A free open-air concert is rocking {place} tonight!', endText: 'The concert is over — ears are still ringing.',
  }),
  good({
    id: 'science_fair', name: 'Science Fair', icon: '🔬', yearlyChance: 0.5, minPopulation: 3_000, duration: 4, summonable: true,
    description: 'Students and researchers show off robots, rockets and inventions. Companies take note.',
    place: 'city', cooldown: 150, boostWhen: 'educated', mods: { demandOff: 0.1, happiness: 2 },
    startText: 'The Science Fair opened near {place}. The robots are surprisingly good at chess.', endText: 'The Science Fair closed its doors.',
  }),
  good({
    id: 'new_year', name: 'New Year Fireworks', icon: '🎇', yearlyChance: 0, minPopulation: 0, duration: 4, summonable: true, scripted: true,
    description: 'The city rings in the new year with fireworks over every park.',
    place: 'park', mods: { happiness: 5, tourismMult: 1.15 },
    startText: 'Happy New Year! Fireworks are bursting over {place}.',
  }),
  good({
    id: 'balloon_parade', name: 'Hot-Air Balloon Parade', icon: '🎈', yearlyChance: 0.45, minPopulation: 800, duration: 10, summonable: true,
    description: 'A fleet of colourful hot-air balloons drifts over the city on the breeze.',
    seasons: ['spring', 'summer', 'autumn'], place: 'city', cooldown: 150, mods: { happiness: 4, tourismMult: 1.2 },
    startText: 'Look up! A hot-air balloon parade is drifting over {place}.', endText: 'The last balloon has landed safely.',
  }),
  good({
    id: 'dino_balloon', name: 'Lost Dinosaur Balloon', icon: '🦕', yearlyChance: 0.06, minPopulation: 1_500, duration: 8, summonable: true,
    description: 'A giant inflatable dinosaur broke loose from a parade and is drifting over the rooftops.',
    place: 'city', cooldown: 360, mods: { happiness: 5, tourismMult: 1.15 },
    startText: 'A giant dinosaur parade balloon broke loose and is floating over {place}!', endText: 'The runaway dinosaur balloon was finally caught.',
  }),
  good({
    id: 'ufo', name: 'UFO Sighting', icon: '🛸', yearlyChance: 0.05, minPopulation: 1_000, duration: 6, summonable: true,
    description: 'Strange lights hover over the city. Scientists are baffled; tourists are thrilled.',
    place: 'city', cooldown: 360, mods: { tourismMult: 1.35, happiness: 2 },
    startText: 'Unidentified flying object reported over {place}! Citizens can\'t stop chirping about it.', endText: 'The UFO vanished as mysteriously as it appeared.',
  }),
  good({
    id: 'meteor_shower', name: 'Meteor Shower', icon: '🌠', yearlyChance: 0.35, minPopulation: 300, duration: 6, summonable: true,
    description: 'A spectacular meteor shower streaks across the night sky. Stargazers flock to the hills.',
    place: 'none', cooldown: 180, mods: { tourismMult: 1.2, happiness: 3 },
    startText: 'A meteor shower is lighting up the night sky. Make a wish!', endText: 'The meteor shower has passed.',
  }),
  good({
    id: 'baby_boom', name: 'Baby Boom', icon: '👶', yearlyChance: 0.3, minPopulation: 3_000, duration: 45, summonable: true,
    description: 'Maternity wards are busy. Young families want bigger homes.',
    place: 'none', cooldown: 360, mods: { demandRes: 0.2, happiness: 2 },
    startText: 'A baby boom! Young families are looking for homes.', endText: 'The baby boom has settled down.',
  }),
  good({
    id: 'investment', name: 'Foreign Investment', icon: '💼', yearlyChance: 0.35, minPopulation: 5_000, duration: 25, summonable: true,
    description: 'An overseas conglomerate invests in local industry and pays a generous signing bonus.',
    place: 'none', cooldown: 300, boostWhen: 'industry', moneyPer1k: 250, mods: { demandInd: 0.25, demandCom: 0.05 },
    startText: 'A foreign conglomerate is investing in the city! A signing bonus was paid into the treasury.', endText: 'The investment programme has concluded.',
  }),
  good({
    id: 'cherry_blossom', name: 'Blossom Season', icon: '🌸', yearlyChance: 0.7, minPopulation: 500, duration: 12, summonable: true,
    description: 'The trees burst into bloom. Parks fill with picnics and photographers.',
    seasons: ['spring'], themes: ['temperate', 'mediterranean', 'alpine', 'tropical'], place: 'park', cooldown: 300,
    mods: { happiness: 3, tourismMult: 1.2 },
    startText: 'Blossom season has arrived! {place} is a sea of pink.', endText: 'The blossoms have fallen. See you next spring.',
  }),

  // ══ NEGATIVE ══════════════════════════════════════════════════════════════
  bad({
    id: 'recession', name: 'Recession', icon: '📉', yearlyChance: 0.18, minPopulation: 6_000, duration: 60, summonable: true,
    description: 'A global downturn hits. Businesses hesitate, tax income shrinks and people move less.',
    place: 'none', cooldown: 540, mods: { demandRes: -0.15, demandCom: -0.2, demandInd: -0.2, demandOff: -0.2, incomeMult: 0.9, tourismMult: 0.85, happiness: -4 },
    startText: 'A recession has hit the economy. Demand and tax income will suffer.', endText: 'The recession is over. The economy is recovering.',
  }, 'danger'),
  bad({
    id: 'strike', name: 'General Strike', icon: '✊', yearlyChance: 0.2, minPopulation: 4_000, duration: 8, summonable: true,
    description: 'Unions walk out over wages. Construction halts and businesses lose income.',
    place: 'city', cooldown: 240, boostWhen: 'highTax', mods: { incomeMult: 0.88, constructionMult: 0.35, happiness: -3, demandInd: -0.05 },
    startText: 'Workers have gone on strike! Picket lines formed near {place}.', endText: 'The strike is over — a deal was reached.',
  }),
  bad({
    id: 'epidemic', name: 'Flu Epidemic', icon: '🤒', yearlyChance: 0.25, minPopulation: 2_000, duration: 20, summonable: true,
    description: 'A nasty flu is spreading. Clinics are overwhelmed and people stay home.',
    seasons: ['autumn', 'winter'], place: 'none', cooldown: 240, boostWhen: 'lowHealth', mods: { healthMult: 1.6, happiness: -4, incomeMult: 0.96, tourismMult: 0.85 },
    startText: 'A flu epidemic is spreading. Hospitals and clinics are under pressure.', endText: 'The epidemic is over.',
  }, 'danger'),
  bad({
    id: 'crime_wave', name: 'Crime Wave', icon: '🦹', yearlyChance: 0.22, minPopulation: 3_000, duration: 20, summonable: true,
    description: 'Organised gangs move in. Burglaries and car thefts spike.',
    place: 'city', cooldown: 240, boostWhen: 'highCrime', mods: { crimeMult: 1.6, happiness: -4, tourismMult: 0.9 },
    startText: 'A crime wave is sweeping through {place}. Citizens want more police.', endText: 'The crime wave has subsided.',
  }),
  bad({
    id: 'power_failure', name: 'Power Grid Failure', icon: '🔌', yearlyChance: 0.2, minPopulation: 1_500, duration: 3, summonable: true,
    description: 'A substation fails and the grid buckles under the load. Rolling blackouts follow.',
    place: 'none', cooldown: 180, mods: { powerUseMult: 1.45, happiness: -3, incomeMult: 0.97 },
    startText: 'A grid failure is causing rolling blackouts across the city!', endText: 'The power grid has been repaired.',
  }, 'danger'),
  bad({
    id: 'water_main_break', name: 'Water Main Break', icon: '🚰', yearlyChance: 0.25, minPopulation: 1_000, duration: 4, summonable: true,
    description: 'An old water main bursts, flooding a street with a geyser and cutting supply.',
    place: 'road', cooldown: 150, mods: { waterSupplyMult: 0.75, happiness: -1, trafficMult: 1.05 },
    startText: 'A water main burst near {place}! A geyser is flooding the street.', endText: 'The water main has been repaired.',
  }),
  bad({
    id: 'heat_wave', name: 'Heat Wave', icon: '🥵', yearlyChance: 0.35, minPopulation: 200, duration: 8, summonable: true,
    description: 'Scorching temperatures push air conditioners and water supplies to the limit. Fires start easily.',
    seasons: ['summer'], place: 'none', cooldown: 90, boostWhen: 'hot', weather: 'heatwave', weatherIntensity: 0.9,
    mods: { healthMult: 1.15 },
    startText: 'A heat wave has arrived! Power and water use will soar and fire risk is high.', endText: 'The heat wave has broken.',
  }, 'danger'),
  bad({
    id: 'drought', name: 'Drought', icon: '🏜️', yearlyChance: 0.25, minPopulation: 500, duration: 30, summonable: true,
    description: 'Weeks without rain. Reservoirs drop, crops wither and forests become tinder.',
    seasons: ['summer', 'autumn'], place: 'none', cooldown: 300, boostWhen: 'dry',
    mods: { waterSupplyMult: 0.65, fireRiskMult: 1.8, happiness: -2, demandInd: -0.04 },
    startText: 'A drought has been declared. Water supply is reduced and fire risk is up.', endText: 'The drought is over — the rains have returned.',
  }, 'danger'),
  bad({
    id: 'traffic_jam', name: 'Gridlock', icon: '🚗', yearlyChance: 0.3, minPopulation: 4_000, duration: 3, summonable: true,
    description: 'A multi-car pile-up and a broken signal system bring traffic to a standstill.',
    place: 'road', cooldown: 90, mods: { trafficMult: 1.5, happiness: -2, incomeMult: 0.98 },
    startText: 'Gridlock! A pile-up near {place} has traffic backed up for miles.', endText: 'Traffic is flowing again.',
  }),
  bad({
    id: 'pest_outbreak', name: 'Pest Outbreak', icon: '🐀', yearlyChance: 0.2, minPopulation: 1_500, duration: 12, summonable: true,
    description: 'Rats and cockroaches thrive on uncollected garbage. Health inspectors are busy.',
    seasons: ['spring', 'summer'], place: 'city', cooldown: 200, mods: { healthMult: 1.25, happiness: -3, demandCom: -0.04, tourismMult: 0.92 },
    startText: 'A pest outbreak was reported around {place}. Keep the garbage trucks rolling!', endText: 'The pest outbreak has been contained.',
  }),
  bad({
    id: 'protest', name: 'Protest March', icon: '📢', yearlyChance: 0.25, minPopulation: 2_500, duration: 3, summonable: true,
    description: 'Unhappy citizens march on city hall. They want lower taxes and better services.',
    place: 'park', cooldown: 150, boostWhen: 'lowHappiness', mods: { happiness: -3, trafficMult: 1.12, demandRes: -0.04 },
    startText: 'Citizens are protesting at {place}. They want lower taxes and better services!', endText: 'The protesters have gone home.',
  }),
  bad({
    id: 'cold_snap', name: 'Cold Snap', icon: '🥶', yearlyChance: 0.3, minPopulation: 300, duration: 8, summonable: true,
    description: 'Arctic air freezes the city. Heating demand soars and pipes crack.',
    seasons: ['winter'], place: 'none', cooldown: 120, boostWhen: 'winter',
    mods: { powerUseMult: 1.25, waterSupplyMult: 0.92, healthMult: 1.12, happiness: -2, trafficMult: 1.08 },
    startText: 'A cold snap has frozen the city. Heating demand is soaring.', endText: 'The cold snap is over.',
  }),

  // ══ DISASTERS ═════════════════════════════════════════════════════════════
  bad({
    id: 'fire', name: 'Building Fire', icon: '🔥', yearlyChance: 0, minPopulation: 0, duration: 0, summonable: true,
    description: 'Flames engulf a building and threaten its neighbours. Fire coverage and fire trucks put it out.',
    place: 'building', hazard: 'fire',
    startText: 'A fire broke out at {place}! Fire crews are on their way.', endText: 'The fire at {place} is out.',
  }, 'danger'),
  disaster({
    id: 'forest_fire', name: 'Forest Fire', icon: '🌲', yearlyChance: 0.3, minPopulation: 300, duration: 0, summonable: true,
    description: 'A wildfire races through the forest, jumping from tree to tree with the wind.',
    seasons: ['summer', 'autumn'], place: 'forest', cooldown: 60, boostWhen: 'dry', hazard: 'fire',
    mods: { happiness: -2, tourismMult: 0.9 },
    startText: 'A forest fire is spreading near {place}! Fire helicopters help keep it in check.', endText: 'The forest fire has burned out.',
  }),
  disaster({
    id: 'tornado', name: 'Tornado', icon: '🌪️', yearlyChance: 0.12, minPopulation: 800, duration: 6, summonable: true,
    description: 'A violent twister touches down, tearing through buildings and forests along its path.',
    seasons: ['spring', 'summer'], themes: ['temperate', 'boreal', 'desert', 'tropical', 'mediterranean'], place: 'city', cooldown: 240, boostWhen: 'storm', hazard: 'storm',
    weather: 'storm', weatherIntensity: 0.9, mods: { happiness: -5, tourismMult: 0.8, constructionMult: 0.7 },
    startText: 'TORNADO! A funnel cloud touched down near {place}. Take shelter!', endText: 'The tornado has dissipated.',
  }),
  disaster({
    id: 'earthquake', name: 'Earthquake', icon: '🫨', yearlyChance: 0.08, minPopulation: 1_500, duration: 2, summonable: true,
    description: 'The ground heaves and shakes. Tall, old buildings are the most likely to collapse.',
    place: 'city', cooldown: 360, hazard: 'quake', mods: { happiness: -6, tourismMult: 0.75, constructionMult: 0.8 },
    startText: 'EARTHQUAKE! A strong quake struck near {place}.', endText: 'The aftershocks have stopped. Time to rebuild.',
  }),
  disaster({
    id: 'meteor', name: 'Meteor Strike', icon: '☄️', yearlyChance: 0.05, minPopulation: 2_000, duration: 5, summonable: true,
    description: 'A blazing rock from space slams into the ground, leaving a smoking crater.',
    place: 'city', cooldown: 360, hazard: 'impact', mods: { happiness: -4, tourismMult: 1.1 },
    startText: 'A meteor is plunging toward {place}! Impact imminent!', endText: 'The meteor crater has stopped smoking. Tourists are already visiting.',
  }),
  disaster({
    id: 'giant_meteor', name: 'Giant Meteor', icon: '🌑', yearlyChance: 0.008, minPopulation: 20_000, duration: 8, summonable: true,
    description: 'An extinction-class boulder. The crater will be visible from orbit.',
    place: 'city', cooldown: 720, hazard: 'impact', mods: { happiness: -10, tourismMult: 1.2, constructionMult: 0.7 },
    startText: 'A GIANT METEOR is heading straight for {place}! Brace for impact!', endText: 'The giant crater has cooled. It is already a landmark.',
  }),
  disaster({
    id: 'flood', name: 'Flood / Storm Surge', icon: '🌊', yearlyChance: 0.12, minPopulation: 500, duration: 10, summonable: true,
    description: 'Heavy rain and a storm surge push the sea over its banks. Low-lying neighbourhoods go under.',
    seasons: ['spring', 'autumn', 'winter'], place: 'coast', coastal: true, cooldown: 240, boostWhen: 'storm', hazard: 'flood',
    weather: 'rain', weatherIntensity: 1, mods: { happiness: -5, trafficMult: 1.25, tourismMult: 0.85 },
    startText: 'Flood warning! A storm surge is pushing the sea inland near {place}.', endText: 'The flood waters have receded.',
  }),
  disaster({
    id: 'tsunami', name: 'Tsunami', icon: '🌊', yearlyChance: 0.03, minPopulation: 3_000, duration: 8, summonable: true,
    description: 'An undersea quake sends a wall of water toward the coast. Warning buoys buy precious time.',
    place: 'coast', coastal: true, cooldown: 720, hazard: 'tsunami', mods: { happiness: -8, tourismMult: 0.7, constructionMult: 0.8 },
    startText: 'TSUNAMI! A giant wave is racing toward the coast at {place}!', endText: 'The tsunami waters have drained back to the sea.',
  }),
  disaster({
    id: 'sinkhole', name: 'Sinkhole', icon: '🕳️', yearlyChance: 0.1, minPopulation: 1_000, duration: 2, summonable: true,
    description: 'The ground gives way without warning, swallowing whatever stands above.',
    place: 'building', cooldown: 180, hazard: 'ground', mods: { happiness: -2 },
    startText: 'A sinkhole opened up at {place}!', endText: 'Engineers have secured the sinkhole.',
  }),
  disaster({
    id: 'lightning', name: 'Lightning Strike', icon: '⚡', yearlyChance: 0.2, minPopulation: 200, duration: 1, summonable: true,
    description: 'A bolt from a thunderstorm hits the tallest structure around and sets it ablaze.',
    seasons: ['spring', 'summer', 'autumn'], place: 'tall', cooldown: 30, boostWhen: 'storm', hazard: 'storm',
    startText: 'Lightning struck {place} and started a fire!',
  }),
  disaster({
    id: 'explosion', name: 'Industrial Explosion', icon: '💥', yearlyChance: 0.1, minPopulation: 1_500, duration: 4, summonable: true,
    description: 'A chemical tank ruptures and ignites. The blast levels the plant and sets its neighbours on fire.',
    place: 'industry', cooldown: 240, boostWhen: 'industry', hazard: 'fire', mods: { happiness: -3, healthMult: 1.08 },
    startText: 'EXPLOSION at {place}! Emergency services are responding.', endText: 'The explosion site has been secured.',
  }),
  disaster({
    id: 'blizzard', name: 'Blizzard', icon: '🌨️', yearlyChance: 0.3, minPopulation: 200, duration: 5, summonable: true,
    description: 'Howling winds and heavy snow bury the city. Roads crawl and heating demand explodes.',
    seasons: ['winter'], place: 'none', cooldown: 90, boostWhen: 'winter', hazard: 'storm',
    weather: 'blizzard', weatherIntensity: 1, mods: { happiness: -3 },
    startText: 'A blizzard is burying the city in snow! Traffic will crawl.', endText: 'The blizzard has passed. Time to dig out.',
  }),
];

const BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

export function eventDef(id: string): EventSpec | undefined {
  return BY_ID.get(id);
}

/** ids usable with `/summon` (plus a few aliases the EventSystem resolves) */
export const EVENT_ALIASES: Record<string, string> = {
  storm_surge: 'flood',
  surge: 'flood',
  quake: 'earthquake',
  twister: 'tornado',
  building_fire: 'fire',
  wildfire: 'forest_fire',
  fireworks: 'new_year',
  balloons: 'balloon_parade',
  dinosaur: 'dino_balloon',
  heatwave: 'heat_wave',
  gridlock: 'traffic_jam',
  blackout: 'power_failure',
};

export type { EventDef };
