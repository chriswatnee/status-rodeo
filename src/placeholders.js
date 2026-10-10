// Placeholder lines for the composer, one picked at random each time the home page is
// drawn. They are only a hint in an empty box: the field's real label stays "What's your
// status?" (see renderHome), so a screen reader never depends on which line was chosen.
// Keep every line short: on a 360px phone the placeholder must fit on one line (the
// unit test caps the length).
export const PLACEHOLDER_MAX_LENGTH = 28;

export const COMPOSER_PLACEHOLDERS = [
  'Howdy, partner. What’s up?',
  'This ain’t my first rodeo…',
  'Saddle up. What’s new?',
  'Yeehaw! What’s going on?',
  'What’s the news, cowpoke?',
  'What’s the word, pardner?',
  'Back in the saddle again…',
  'What’s happenin’ out west?',
  'Round up your thoughts…',
  'Well, howdy there…',
  'Howdy, stranger…',
  'Anything to report, partner?',
  'What’s the talk in town?',
  'Tell us what’s goin’ on…',
  'Spill it, pardner…',
  'How’s the trail treatin’ ya?',
];

// One line, never the same as `previous` (so going home twice in a row changes it).
// `random` is Math.random in the app; it is a parameter so the tests are exact.
export function pickPlaceholder(previous = null, random = Math.random, lines = COMPOSER_PLACEHOLDERS) {
  const choices = lines.length > 1 ? lines.filter((line) => line !== previous) : lines;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));

  return choices[index];
}
