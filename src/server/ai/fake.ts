import type { DiscoveryOutput } from "./prompts";

/**
 * Scripted responses for LLM_MODE=fake (tests, CI, offline UI work). Real Wikipedia titles,
 * so enrichment works against the live API in development. Unknown cities get an empty list.
 */
type A = DiscoveryOutput["attractions"][number];
const a = (
  name: string,
  wikiTitle: string,
  category: string,
  tags: string[],
  visitMinutes: number,
  pitch: string,
): A => ({ name, wikiTitle, category, tags, visitMinutes, pitch });

const DISCOVERY_FIXTURES: Record<string, A[]> = {
  rome: [
    a(
      "Colosseum",
      "Colosseum",
      "historic-site",
      ["history", "iconic"],
      120,
      "Stand where 50,000 Romans cheered gladiators.",
    ),
    a(
      "Roman Forum",
      "Roman Forum",
      "historic-site",
      ["history", "architecture"],
      90,
      "Walk the heart of the ancient empire.",
    ),
    a(
      "Pantheon",
      "Pantheon, Rome",
      "landmark",
      ["history", "architecture", "iconic"],
      30,
      "A 2,000-year-old dome that still defies engineers.",
    ),
    a(
      "Trevi Fountain",
      "Trevi Fountain",
      "landmark",
      ["art", "iconic"],
      20,
      "Toss a coin to make sure you come back.",
    ),
    a(
      "Vatican Museums",
      "Vatican Museums",
      "museum",
      ["art", "history"],
      180,
      "Endless galleries ending under Michelangelo's ceiling.",
    ),
    a(
      "St. Peter's Basilica",
      "St. Peter's Basilica",
      "religious-site",
      ["religion", "architecture", "iconic"],
      90,
      "Climb the dome for the best view in Rome.",
    ),
    a(
      "Spanish Steps",
      "Spanish Steps",
      "landmark",
      ["architecture", "local-life"],
      20,
      "The city's most famous place to sit and people-watch.",
    ),
    a(
      "Piazza Navona",
      "Piazza Navona",
      "landmark",
      ["art", "local-life"],
      30,
      "Baroque fountains on an ancient stadium track.",
    ),
    a(
      "Castel Sant'Angelo",
      "Castel Sant'Angelo",
      "palace",
      ["history", "views"],
      90,
      "An emperor's tomb turned papal fortress.",
    ),
    a(
      "Borghese Gallery",
      "Galleria Borghese",
      "museum",
      ["art"],
      120,
      "Bernini's marble that looks like living skin.",
    ),
    a(
      "Trastevere",
      "Trastevere",
      "neighborhood",
      ["food", "local-life", "nightlife"],
      120,
      "Ivy-covered lanes and the city's best trattorias.",
    ),
    a(
      "Villa Borghese gardens",
      "Villa Borghese gardens",
      "park",
      ["nature", "family"],
      60,
      "Rome's green lung, with rowing boats and views.",
    ),
  ],
  paris: [
    a(
      "Eiffel Tower",
      "Eiffel Tower",
      "landmark",
      ["architecture", "views", "iconic"],
      120,
      "The iron icon, best at its sparkling night show.",
    ),
    a(
      "Louvre",
      "Louvre",
      "museum",
      ["art", "history", "iconic"],
      180,
      "Say hello to the Mona Lisa and 35,000 other works.",
    ),
    a(
      "Notre-Dame",
      "Notre-Dame de Paris",
      "religious-site",
      ["religion", "architecture", "iconic"],
      60,
      "The reborn Gothic masterpiece on the Seine.",
    ),
    a(
      "Musée d'Orsay",
      "Musée d'Orsay",
      "museum",
      ["art"],
      150,
      "Impressionist treasures inside a Belle Époque station.",
    ),
    a(
      "Sacré-Cœur",
      "Sacré-Cœur, Paris",
      "religious-site",
      ["religion", "views"],
      60,
      "A white basilica crowning Montmartre's hill.",
    ),
    a(
      "Montmartre",
      "Montmartre",
      "neighborhood",
      ["art", "local-life"],
      120,
      "Artists' squares and winding village streets.",
    ),
    a(
      "Arc de Triomphe",
      "Arc de Triomphe",
      "landmark",
      ["history", "views"],
      60,
      "Climb up for the star-shaped avenues below.",
    ),
    a(
      "Sainte-Chapelle",
      "Sainte-Chapelle",
      "religious-site",
      ["religion", "art", "hidden-gem"],
      45,
      "Walls made almost entirely of stained glass.",
    ),
    a(
      "Luxembourg Gardens",
      "Jardin du Luxembourg",
      "park",
      ["nature", "family"],
      60,
      "Parisians' favourite chairs, fountains and lawns.",
    ),
    a(
      "Centre Pompidou",
      "Centre Pompidou",
      "museum",
      ["art", "architecture"],
      120,
      "Modern art in a building worn inside out.",
    ),
    a(
      "Le Marais",
      "Le Marais",
      "neighborhood",
      ["shopping", "food", "local-life"],
      120,
      "Medieval lanes, falafel and boutique hopping.",
    ),
    a(
      "Palace of Versailles",
      "Palace of Versailles",
      "palace",
      ["history", "art", "iconic"],
      240,
      "The Sun King's dazzling Hall of Mirrors.",
    ),
  ],
};

export function fakeDiscoveryResponse(cityName: string, exclude: readonly string[] = []): string {
  const skip = new Set(exclude);
  const attractions = (DISCOVERY_FIXTURES[cityName.trim().toLowerCase()] ?? []).filter(
    (x) => !skip.has(x.wikiTitle),
  );
  return JSON.stringify({ attractions } satisfies DiscoveryOutput);
}
